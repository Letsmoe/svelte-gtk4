import { readdirSync, watch, type Dirent, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from '@neoworks/extension-system'
import { requireService } from '../services.js'
import type { Bus } from '../bus.js'

// hotReloadPlugin watches the trees a running host can swap without a restart
// and announces what changed:
//
//   hot.backend {id}   an extension's backend module
//   hot.views   {id}   an extension's built views bundle
//   hot.surface {}     the surface runtime, published by surfacePage once it
//                      has rebundled
//
// The owners react — the extension loader remounts the fiber, the view tree
// remounts the webview module, surfaces reload the page. Everything reloadable
// here already had a disposal path; this plugin only supplies the trigger.
//
// Not reloadable: the core plugins (bus, http, config, surfaces, view tree)
// whose identity everything else holds, and the render host. Those need a
// restart — and a restart of the host takes the render host with it, which is
// exactly why the reloadable parts are worth reloading in place.
//
// Off unless NEOSHELL_HOT is set: a shipped shell has no business watching the
// filesystem.

export interface HotReloadConfig {
  extensionsDir: string
}

export interface Change {
  topic: string
  id: string
}

const DEBOUNCE_MS = 120

export const hotReloadPlugin: Plugin.Object<HotReloadConfig> = {
  name: 'hot-reload',
  inject: ['bus'],
  apply(context, config) {
    if (!hotReloadEnabled()) {
      return
    }
    const bus = requireService<Bus>(context, 'bus')
    const announcer = new ChangeAnnouncer(bus)
    context.effect(() => () => announcer.dispose())
    context.effect(() =>
      watchTree(config.extensionsDir, (path) => {
        announcer.announce(path)
      }),
    )
    console.log(`host: hot reload watching ${config.extensionsDir}`)
  },
}

export function hotReloadEnabled(): boolean {
  const flag = process.env.NEOSHELL_HOT
  if (flag === undefined || flag === '' || flag === '0') {
    return false
  }
  return true
}

// classifyChange maps a path relative to the extensions dir onto the reload it
// should trigger. Source files under <id>/src are compiled into <id>/dist, so
// the dist write is the signal — reacting to both would reload twice, once
// against a bundle that has not been rebuilt yet.
export function classifyChange(relativePath: string): Change | null {
  const parts = relativePath.split('/')
  if (parts.length < 2 || parts.includes('node_modules')) {
    return null
  }
  const id = parts[0]
  if (parts[1] === 'dist') {
    return { topic: 'hot.views', id }
  }
  if (parts[1] === 'src') {
    return null
  }
  if (relativePath.endsWith('.ts') || relativePath.endsWith('.json')) {
    return { topic: 'hot.backend', id }
  }
  return null
}

// ChangeAnnouncer collapses the burst of events a single save produces — an
// editor writing through a temp file emits several — into one publish per
// target.
class ChangeAnnouncer {
  private readonly bus: Bus
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(bus: Bus) {
    this.bus = bus
  }

  announce(relativePath: string): void {
    const change = classifyChange(relativePath)
    if (change === null) {
      return
    }
    this.schedule(change)
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
  }

  private schedule(change: Change): void {
    const key = `${change.topic}:${change.id}`
    const pending = this.timers.get(key)
    if (pending !== undefined) {
      clearTimeout(pending)
    }
    this.timers.set(
      key,
      setTimeout(() => this.fire(key, change), DEBOUNCE_MS),
    )
  }

  private fire(key: string, change: Change): void {
    this.timers.delete(key)
    console.log(`host: hot reload ${change.topic} ${change.id}`)
    this.bus.publish(change.topic, { id: change.id })
  }
}

// watchTree follows every extension directory recursively, one watcher each.
// Watching the extensions dir as a whole would drag in its node_modules, where
// a stale symlink from a removed workspace package is enough to fault the
// watch — and where nothing is ever hot reloaded anyway.
export function watchTree(dir: string, onChange: (relativePath: string) => void): () => void {
  const closers = extensionDirsOf(dir).map((name) =>
    watchDir(join(dir, name), (relativePath) => onChange(`${name}/${relativePath}`)),
  )
  return () => {
    for (const close of closers) {
      close()
    }
  }
}

function extensionDirsOf(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter(isExtensionDir).map(nameOf)
  } catch (error) {
    console.error(`host: cannot read ${dir}, hot reload disabled:`, error)
    return []
  }
}

function isExtensionDir(entry: Dirent): boolean {
  return entry.isDirectory() && entry.name !== 'node_modules'
}

function nameOf(entry: Dirent): string {
  return entry.name
}

// A watch that faults takes only itself out: the rest of the tree stays
// reloadable, and the host stays up.
function watchDir(dir: string, onChange: (relativePath: string) => void): () => void {
  let watcher: FSWatcher
  try {
    watcher = watch(dir, { recursive: true }, (_event, changed) => {
      handleWatchEvent(changed, onChange)
    })
  } catch (error) {
    console.error(`host: cannot watch ${dir}, no hot reload for it:`, error)
    return () => {}
  }
  watcher.on('error', (error) => {
    console.error(`host: watch on ${dir} failed, no hot reload for it:`, error)
    watcher.close()
  })
  return () => watcher.close()
}

function handleWatchEvent(
  changed: string | Buffer | null,
  onChange: (relativePath: string) => void,
): void {
  if (changed === null) {
    return
  }
  onChange(changed.toString())
}

// debounced collapses repeated calls into one trailing run, for watchers whose
// changes are not keyed by target.
export function debounced(run: () => void, delayMs = DEBOUNCE_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return () => {
    if (timer !== null) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      timer = null
      run()
    }, delayMs)
  }
}
