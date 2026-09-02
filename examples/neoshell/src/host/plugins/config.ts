import type { Plugin } from '@neoworks/extension-system'
import { requireService } from '../services.js'
import type { Bus, BusMessage } from '../bus.js'
import {
  makeDirectory,
  readTextFile,
  watchDirectory,
  writeTextFile,
} from '../../gjs/fs.js'

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
// subscriber hydrates on subscribe and re-hydrates on every change, including
// external edits to the file.
//
//   config:set  {key, value} → {ok} | {error}
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
    makeDirectory(directoryOf(this.path))
    const data = readConfigFile(this.path)
    if (data !== null) {
      this.data = data
    }
  }

  publishRetained(): () => void {
    this.clearRetained = this.bus.retain('config', this.snapshot())
    return () => this.clearRetained()
  }

  // watchFile picks up external writes and republishes. Watches the directory,
  // so the file may not exist yet.
  watchFile(): () => void {
    const fileName = baseNameOf(this.path)
    return watchDirectory(directoryOf(this.path), (changed) => {
      this.handleFileChange(fileName, changed)
    })
  }

  get(key: string): unknown {
    return getPath(this.data, key)
  }

  set(key: string, value: unknown): void {
    setPath(this.data, key, value)
    this.persist()
    this.republish()
  }

  // GJS has no structuredClone; the tree is plain JSON by construction, so a
  // round trip is the deep copy.
  snapshot(): Record<string, unknown> {
    return JSON.parse(JSON.stringify(this.data)) as Record<string, unknown>
  }

  private handleFileChange(fileName: string, changed: string): void {
    if (this.suppressWatch) {
      return
    }
    if (changed !== '' && changed !== fileName) {
      return
    }
    // A writer that truncates before writing is observable mid-write: keep the
    // last good tree rather than republishing an empty config to every view.
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
    writeTextFile(this.path, JSON.stringify(this.data, null, 2) + '\n')
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
  const raw = readTextFile(path)
  if (raw === null) {
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

function directoryOf(path: string): string {
  const cut = path.lastIndexOf('/')
  if (cut <= 0) {
    return '.'
  }
  return path.slice(0, cut)
}

function baseNameOf(path: string): string {
  const cut = path.lastIndexOf('/')
  if (cut < 0) {
    return path
  }
  return path.slice(cut + 1)
}
