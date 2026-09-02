import type { Plugin } from '@neoworks/extension-system'
import { requireService } from '../lib/services.js'
import { registerFunction, RetainedTopics } from '../lib/bus.js'
import type { BusMessage, BusService } from '../lib/bus.js'

// appearance: the wallpaper/theme bridge, moved out of the Go core
// (internal/wallpaper plus the config-driven apply logic in main.go).
//
//   theme.bar               retained gradient stops from the neoshell-bg daemon
//   wallpaper:set {path}    → {ok} | {error}
//
// It also follows config: appearance.wallpaper changes are pushed to the
// daemon, and appearance.background.blur drives Hyprland's blur keywords via
// the hypr extension's functions (fire-and-forget publishes; the hypr
// extension may not be mounted, in which case they land nowhere — the bus has
// no opinion).

interface AppearanceConfig {
  bgSocketPath?: string
  reconnectMs?: number
}

const RECONNECT_DEFAULT_MS = 2000

const appearanceExtension: Plugin.Object<AppearanceConfig | undefined> = {
  name: 'appearance',
  inject: ['bus'],
  apply(context, config) {
    const bus = requireService<BusService>(context, 'bus')
    const socketPath = resolveSocketPath(config)
    const reconnectMs = resolveReconnectMs(config)
    const retained = new RetainedTopics(bus)

    context.effect(() => watchBarColors(socketPath, reconnectMs, retained))
    context.effect(() => followConfig(bus))
    registerFunction(context, bus, 'wallpaper:set', (data) => setWallpaper(socketPath, data))
  },
}

export default appearanceExtension

function resolveSocketPath(config: AppearanceConfig | undefined): string {
  if (config !== undefined && config.bgSocketPath !== undefined) {
    return config.bgSocketPath
  }
  let runtime = process.env.XDG_RUNTIME_DIR
  if (runtime === undefined || runtime === '') {
    runtime = `/run/user/${process.getuid?.()}`
  }
  return `${runtime}/neoshell-bg.sock`
}

function resolveReconnectMs(config: AppearanceConfig | undefined): number {
  if (config !== undefined && config.reconnectMs !== undefined) {
    return config.reconnectMs
  }
  return RECONNECT_DEFAULT_MS
}

// followConfig reapplies wallpaper and blur whenever the retained config
// snapshot changes. Change detection keeps the daemon and compositor from
// being hammered on unrelated config edits.
function followConfig(bus: BusService): () => void {
  let lastWallpaper = ''
  let lastBlur = -1
  return bus.subscribe('config', (message) => {
    lastWallpaper = applyWallpaperFromConfig(bus, message, lastWallpaper)
    lastBlur = applyBlurFromConfig(bus, message, lastBlur)
  })
}

function applyWallpaperFromConfig(bus: BusService, message: BusMessage, last: string): string {
  const path = configString(message.data, ['appearance', 'wallpaper'])
  if (path === '' || path === last) {
    return last
  }
  bus.publish('wallpaper:set', { path })
  return path
}

function applyBlurFromConfig(bus: BusService, message: BusMessage, last: number): number {
  const size = configNumber(message.data, ['appearance', 'background', 'blur'], 8)
  if (size === last) {
    return last
  }
  bus.publish('hypr:keyword', { name: 'decoration:blur:enabled', value: 'true' })
  bus.publish('hypr:keyword', { name: 'decoration:blur:size', value: String(size) })
  return size
}

function configString(snapshot: unknown, path: string[]): string {
  const value = configValue(snapshot, path)
  if (typeof value === 'string') {
    return value
  }
  return ''
}

function configNumber(snapshot: unknown, path: string[], fallback: number): number {
  const value = configValue(snapshot, path)
  if (typeof value === 'number') {
    return value
  }
  return fallback
}

function configValue(snapshot: unknown, path: string[]): unknown {
  let node: unknown = snapshot
  for (const part of path) {
    if (typeof node !== 'object' || node === null) {
      return undefined
    }
    node = (node as Record<string, unknown>)[part]
  }
  return node
}

// watchBarColors follows the neoshell-bg daemon's gradient stream, retaining
// the latest stops on theme.bar. Reconnects until disposed; a missing daemon
// just means no colors yet.
function watchBarColors(
  socketPath: string,
  reconnectMs: number,
  retained: RetainedTopics,
): () => void {
  const state = { stopped: false, socket: null as { end(): void } | null }
  void runColorLoop(socketPath, reconnectMs, retained, state)
  return () => {
    state.stopped = true
    retained.withdrawAll()
    if (state.socket !== null) {
      state.socket.end()
    }
  }
}

interface ColorLoopState {
  stopped: boolean
  socket: { end(): void } | null
}

async function runColorLoop(
  socketPath: string,
  reconnectMs: number,
  retained: RetainedTopics,
  state: ColorLoopState,
): Promise<void> {
  while (!state.stopped) {
    await streamColors(socketPath, retained, state)
    if (!state.stopped) {
      await Bun.sleep(reconnectMs)
    }
  }
}

function streamColors(
  socketPath: string,
  retained: RetainedTopics,
  state: ColorLoopState,
): Promise<void> {
  let buffer = ''
  const feed = (chunk: string) => {
    buffer += chunk
    const parts = buffer.split('\n')
    buffer = parts[parts.length - 1]
    for (const line of parts.slice(0, -1)) {
      handleDaemonLine(retained, line)
    }
  }
  return new Promise((resolve) => {
    Bun.connect<undefined>({
      unix: socketPath,
      socket: {
        open(socket) {
          state.socket = socket
          socket.write('{"cmd":"subscribe"}\n')
        },
        data(_socket, chunk) {
          feed(chunk.toString())
        },
        close() {
          state.socket = null
          resolve()
        },
        error() {
          state.socket = null
          resolve()
        },
      },
    }).catch(() => resolve())
  })
}

function handleDaemonLine(retained: RetainedTopics, line: string): void {
  if (line.trim() === '') {
    return
  }
  let response: { type?: string; stops?: unknown }
  try {
    response = JSON.parse(line) as { type?: string; stops?: unknown }
  } catch {
    return
  }
  if (response.type === 'colors') {
    retained.set('theme.bar', { stops: response.stops })
  }
}

// setWallpaper tells the daemon to load an image; one connection per command,
// like the Go bridge.
async function setWallpaper(socketPath: string, data: unknown): Promise<unknown> {
  const args = data as { path?: string }
  if (typeof args.path !== 'string' || args.path === '') {
    return { error: 'path is required' }
  }
  try {
    const socket = await Bun.connect<undefined>({
      unix: socketPath,
      socket: { data() {} },
    })
    socket.write(JSON.stringify({ cmd: 'img', path: args.path }) + '\n')
    socket.end()
    return { ok: true }
  } catch (error) {
    return { error: String(error) }
  }
}
