import { mkdirSync, readFileSync, watch, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import type { Plugin } from '@neoworks/extension-system'
import { requireService } from '../services.js'
import type { Bus, BusMessage } from '../bus.js'

export interface ConfigPluginConfig {
  path: string
}

export interface ConfigService {
  get(key: string): unknown
  set(key: string, value: unknown): void
  snapshot(): Record<string, unknown>
}

// configPlugin owns the settings file: a nested JSON tree addressed by
// dot-paths. The full snapshot is a retained bus topic ("config"), so every
// subscriber — surface or daemon — hydrates on subscribe and re-hydrates on
// every change, including external edits to the file.
//
//   config:set  {key, value} → {ok} | {error}
//
// config:set is the write half: a webview reaches the host over the bus alone,
// so without it no surface can persist anything it lets the user change.
export const configPlugin: Plugin.Object<ConfigPluginConfig> = {
  name: 'config',
  inject: ['bus'],
  apply(context, config) {
    const bus = requireService<Bus>(context, 'bus')
    const store = new ConfigStore(config.path, bus)
    store.load()
    context.effect(() => store.publishRetained())
    context.effect(() => store.watchFile())
    context.effect(() =>
      bus.subscribe('config:set', (message) => {
        handleSet(bus, store, message)
      }),
    )
    context.provide('config', store)
  },
}

function handleSet(bus: Bus, store: ConfigService, message: BusMessage): void {
  const request = recordOf(message.data)
  const key = request.key
  if (typeof key !== 'string' || key === '') {
    reply(bus, message, { error: 'config:set needs a string key' })
    return
  }
  store.set(key, request.value)
  reply(bus, message, { ok: true })
}

function reply(bus: Bus, message: BusMessage, data: unknown): void {
  if (message.replyTo === undefined) {
    return
  }
  bus.publish(message.replyTo, data)
}

function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  return value as Record<string, unknown>
}

class ConfigStore implements ConfigService {
  private data: Record<string, unknown> = {}
  private clearRetained: () => void = () => {}
  private suppressWatch = false
  private readonly path: string
  private readonly bus: Bus

  constructor(path: string, bus: Bus) {
    this.path = path
    this.bus = bus
  }

  load(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const data = readConfigFile(this.path)
    if (data !== null) {
      this.data = data
    }
  }

  publishRetained(): () => void {
    this.clearRetained = this.bus.retain('config', this.snapshot())
    return () => this.clearRetained()
  }

  // watchFile picks up external writes (an editor, or the Go core while it
  // still runs alongside) and republishes. Watches the directory, so the file
  // may not exist yet.
  watchFile(): () => void {
    const fileName = basename(this.path)
    const watcher = watch(dirname(this.path), (_event, changed) => {
      this.handleFileChange(fileName, changed)
    })
    return () => watcher.close()
  }

  get(key: string): unknown {
    return getPath(this.data, key)
  }

  set(key: string, value: unknown): void {
    setPath(this.data, key, value)
    this.persist()
    this.republish()
  }

  snapshot(): Record<string, unknown> {
    return structuredClone(this.data)
  }

  private handleFileChange(fileName: string, changed: string | Buffer | null): void {
    if (this.suppressWatch) {
      return
    }
    if (changed !== null && changed.toString() !== fileName) {
      return
    }
    // A writer that truncates before writing is observable mid-write: keep the
    // last good tree rather than republishing an empty config to every surface.
    const data = readConfigFile(this.path)
    if (data === null) {
      return
    }
    this.data = data
    this.republish()
  }

  private republish(): void {
    this.clearRetained()
    this.clearRetained = this.bus.retain('config', this.snapshot())
  }

  private persist(): void {
    this.suppressWatch = true
    writeFileSync(this.path, JSON.stringify(this.data, null, 2) + '\n')
    // The watcher fires on our own write with some delay; suppress briefly.
    setTimeout(() => {
      this.suppressWatch = false
    }, 100)
  }
}

export function getPath(tree: Record<string, unknown>, key: string): unknown {
  let node: unknown = tree
  for (const part of key.split('.')) {
    node = childOf(node, part)
  }
  return node
}

export function setPath(tree: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.')
  const leaf = parts[parts.length - 1]
  let node = tree
  for (const part of parts.slice(0, -1)) {
    node = ensureChildObject(node, part)
  }
  node[leaf] = value
}

function childOf(node: unknown, part: string): unknown {
  if (typeof node !== 'object' || node === null) {
    return undefined
  }
  return (node as Record<string, unknown>)[part]
}

function ensureChildObject(node: Record<string, unknown>, part: string): Record<string, unknown> {
  const existing = node[part]
  if (typeof existing === 'object' && existing !== null) {
    return existing as Record<string, unknown>
  }
  const created: Record<string, unknown> = {}
  node[part] = created
  return created
}

// readConfigFile returns null when the file exists but does not parse — an
// unreadable tree is not an empty tree, and callers keep what they had.
function readConfigFile(path: string): Record<string, unknown> | null {
  let raw = ''
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return {}
  }
  return parseConfig(raw, path)
}

function parseConfig(raw: string, path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, unknown>
    }
  } catch (error) {
    console.error(`host: bad config file ${path}:`, error)
    return null
  }
  return null
}
