import { existsSync, readdirSync, statSync } from 'node:fs'
import type { Plugin } from '@neoworks/extension-system'
import { requireService } from '../lib/services.js'
import { registerFunction, RetainedTopics } from '../lib/bus.js'
import type { BusService } from '../lib/bus.js'

// hypr: the compositor bridge, moved out of the Go core (internal/hyprland).
// This is the load-bearing eviction — window and workspace state is what the
// bar, dock, and desktop all consume. It is published as retained topics with
// no Hyprland types leaking into the names, so a different compositor bridge
// can provide the same contract:
//
//   hypr.windows / hypr.workspaces / hypr.activeworkspace /
//   hypr.activewindow / hypr.monitors        retained query snapshots
//   hypr.event                               raw compositor events, live
//   hypr:dispatch {dispatcher, arg}          → {ok} | {error}
//   hypr:keyword  {name, value}              → {ok} | {error}
//   hypr:request  {command}                  → {reply} | {error}
//
// It also provides the in-kernel "hypr" service for other in-process
// extensions, per the inject example in ARCHITECTURE.md.

interface HyprPaths {
  requestSocket: string
  eventSocket: string
}

interface HyprConfig {
  requestSocket?: string
  eventSocket?: string
}

const REQUEST_TIMEOUT_MS = 3000
const REFRESH_DEBOUNCE_MS = 50
const RECONNECT_DELAY_MS = 1000

const hyprExtension: Plugin.Object<HyprConfig | undefined> = {
  name: 'hypr',
  inject: ['bus'],
  apply(context, config) {
    const bus = requireService<BusService>(context, 'bus')
    const paths = resolvePaths(config)
    const client = new HyprClient(paths)
    const publisher = new HyprPublisher(bus, client)
    context.effect(() => publisher.start())
    context.effect(() => watchEventSocket(paths.eventSocket, (line) => publisher.handleEvent(line)))
    registerFunction(context, bus, 'hypr:dispatch', (data) => runDispatch(client, data))
    registerFunction(context, bus, 'hypr:keyword', (data) => runKeyword(client, data))
    registerFunction(context, bus, 'hypr:request', (data) => runRequest(client, data))
    context.provide('hypr', client)
  },
}

export default hyprExtension

function resolvePaths(config: HyprConfig | undefined): HyprPaths {
  if (config !== undefined && config.requestSocket !== undefined && config.eventSocket !== undefined) {
    return { requestSocket: config.requestSocket, eventSocket: config.eventSocket }
  }
  const base = resolveInstanceDir(`${runtimeDir()}/hypr`, process.env.HYPRLAND_INSTANCE_SIGNATURE)
  return { requestSocket: `${base}/.socket.sock`, eventSocket: `${base}/.socket2.sock` }
}

// resolveInstanceDir prefers the signature, but a shell started from an older
// session's environment inherits one whose socket is long gone — dead
// signatures fall back to the newest instance that still has one.
export function resolveInstanceDir(root: string, signature: string | undefined): string {
  if (signature !== undefined && signature !== '' && hasRequestSocket(`${root}/${signature}`)) {
    return `${root}/${signature}`
  }
  const newest = newestInstance(root)
  if (newest === null) {
    throw new Error(`hypr: no live compositor instance under ${root}`)
  }
  console.warn(`hypr: HYPRLAND_INSTANCE_SIGNATURE is stale, using ${newest}`)
  return newest
}

function newestInstance(root: string): string | null {
  const live = liveInstances(root)
  if (live.length === 0) {
    return null
  }
  live.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
  return live[0]
}

function liveInstances(root: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return []
  }
  return entries.map((entry) => `${root}/${entry}`).filter(hasRequestSocket)
}

function hasRequestSocket(dir: string): boolean {
  return existsSync(`${dir}/.socket.sock`)
}

function runtimeDir(): string {
  const dir = process.env.XDG_RUNTIME_DIR
  if (dir !== undefined && dir !== '') {
    return dir
  }
  return `/run/user/${process.getuid?.()}`
}

// HyprClient speaks Hyprland's request IPC: one command per connection,
// Hyprland writes the reply and closes, so reading to EOF is the completion
// signal.
export class HyprClient {
  private readonly paths: HyprPaths

  constructor(paths: HyprPaths) {
    this.paths = paths
  }

  request(command: string): Promise<string> {
    const chunks: string[] = []
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`hypr: request "${command}" timed out`))
      }, REQUEST_TIMEOUT_MS)
      const settle = () => {
        clearTimeout(timer)
        resolve(chunks.join(''))
      }
      Bun.connect<undefined>({
        unix: this.paths.requestSocket,
        socket: {
          open(socket) {
            socket.write(command)
          },
          data(_socket, chunk) {
            chunks.push(chunk.toString())
          },
          close: settle,
          error(_socket, error) {
            clearTimeout(timer)
            reject(error)
          },
        },
      }).catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
  }

  async requestJson<Result>(command: string): Promise<Result> {
    const raw = await this.request(`j/${command}`)
    return JSON.parse(raw) as Result
  }

  dispatch(dispatcher: string, arg: string): Promise<string> {
    return this.request(`dispatch ${dispatcher} ${arg}`)
  }

  keyword(name: string, value: string): Promise<string> {
    return this.request(`keyword ${name} ${value}`)
  }
}

// HyprPublisher keeps the retained state topics current: a full refresh on
// start, then a debounced refresh on every compositor event. Per-query
// failures (e.g. no active window) skip that topic and keep the rest.
class HyprPublisher {
  private readonly bus: BusService
  private readonly client: HyprClient
  private readonly retained: RetainedTopics
  private refreshTimer: ReturnType<typeof setTimeout> | null = null

  constructor(bus: BusService, client: HyprClient) {
    this.bus = bus
    this.client = client
    this.retained = new RetainedTopics(bus)
  }

  start(): () => void {
    void this.refreshAll()
    return () => {
      this.cancelScheduledRefresh()
      this.retained.withdrawAll()
    }
  }

  handleEvent(line: string): void {
    const separatorIndex = line.indexOf('>>')
    if (separatorIndex < 0) {
      return
    }
    this.bus.publish('hypr.event', {
      event: line.slice(0, separatorIndex),
      data: line.slice(separatorIndex + 2),
    })
    this.scheduleRefresh()
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) {
      return
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      void this.refreshAll()
    }, REFRESH_DEBOUNCE_MS)
  }

  private cancelScheduledRefresh(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  private async refreshAll(): Promise<void> {
    await this.publishQuery('hypr.windows', 'clients')
    await this.publishQuery('hypr.workspaces', 'workspaces')
    await this.publishQuery('hypr.activeworkspace', 'activeworkspace')
    await this.publishQuery('hypr.activewindow', 'activewindow')
    await this.publishQuery('hypr.monitors', 'monitors')
  }

  private async publishQuery(topic: string, command: string): Promise<void> {
    let data: unknown
    try {
      data = await this.client.requestJson(command)
    } catch {
      return
    }
    this.retained.set(topic, data)
  }
}

// watchEventSocket follows Hyprland's socket2 event stream, reconnecting until
// disposed — the compositor restarting must not kill the bridge.
function watchEventSocket(socketPath: string, onLine: (line: string) => void): () => void {
  const state = { stopped: false, socket: null as { end(): void } | null }
  void runEventLoop(socketPath, onLine, state)
  return () => {
    state.stopped = true
    if (state.socket !== null) {
      state.socket.end()
    }
  }
}

interface EventLoopState {
  stopped: boolean
  socket: { end(): void } | null
}

async function runEventLoop(
  socketPath: string,
  onLine: (line: string) => void,
  state: EventLoopState,
): Promise<void> {
  while (!state.stopped) {
    await followEventStream(socketPath, onLine, state)
    if (!state.stopped) {
      await Bun.sleep(RECONNECT_DELAY_MS)
    }
  }
}

// followEventStream reads newline-delimited events off one connection and
// resolves when it closes or fails.
function followEventStream(
  socketPath: string,
  onLine: (line: string) => void,
  state: EventLoopState,
): Promise<void> {
  let buffer = ''
  const feed = (chunk: string) => {
    buffer += chunk
    const parts = buffer.split('\n')
    buffer = parts[parts.length - 1]
    for (const line of parts.slice(0, -1)) {
      onLine(line)
    }
  }
  return new Promise((resolve) => {
    Bun.connect<undefined>({
      unix: socketPath,
      socket: {
        open(socket) {
          state.socket = socket
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

async function runDispatch(client: HyprClient, data: unknown): Promise<unknown> {
  const args = data as { dispatcher?: string; arg?: string }
  if (typeof args.dispatcher !== 'string' || args.dispatcher === '') {
    return { error: 'dispatcher is required' }
  }
  await client.dispatch(args.dispatcher, stringOrEmpty(args.arg))
  return { ok: true }
}

async function runKeyword(client: HyprClient, data: unknown): Promise<unknown> {
  const args = data as { name?: string; value?: string }
  if (typeof args.name !== 'string' || args.name === '') {
    return { error: 'name is required' }
  }
  await client.keyword(args.name, stringOrEmpty(args.value))
  return { ok: true }
}

async function runRequest(client: HyprClient, data: unknown): Promise<unknown> {
  const args = data as { command?: string }
  if (typeof args.command !== 'string' || args.command === '') {
    return { error: 'command is required' }
  }
  return { reply: await client.request(args.command) }
}

function stringOrEmpty(value: string | undefined): string {
  if (value === undefined) {
    return ''
  }
  return value
}
