import { spawn } from 'node:child_process'
import type { Socket } from 'bun'
import type { Plugin } from '@neoworks/extension-system'
import { requireService } from '../services.js'
import type { Bus } from '../bus.js'

export interface RenderHostConfig {
  // Path to the neoshell-render binary; empty skips spawning (attach to an
  // already-running host instead).
  binaryPath: string
  socketPath: string
}

export interface SurfaceSpec {
  role: string
  url: string
  monitor?: string
  layer: 'background' | 'bottom' | 'top' | 'overlay'
  anchors: string[]
  keyboard: 'none' | 'ondemand' | 'exclusive'
  width?: number
  height?: number
  exclusiveEdge?: 'top' | 'bottom' | 'left' | 'right'
  exclusiveSize?: number
}

export interface InputRect {
  x: number
  y: number
  w: number
  h: number
}

export interface RenderEvent {
  event: string
  role?: string
  [key: string]: unknown
}

// renderHostPlugin spawns the C++/WPE render host and drives its control
// socket (NDJSON, protocol shared with the previous Go core). Events flow onto
// the bus as render.<event>.
export const renderHostPlugin: Plugin.Object<RenderHostConfig> = {
  name: 'render-host',
  inject: ['bus'],
  async apply(context, config) {
    const bus = requireService<Bus>(context, 'bus')
    if (config.binaryPath !== '') {
      context.effect(() => spawnRenderHost(config.binaryPath))
    }
    const client = await connectWithRetry(config.socketPath, 5000)
    context.effect(() => () => client.close())
    client.onEvent((event) => {
      bus.publish(`render.${event.event}`, event)
    })
    context.provide('renderhost', client)
    // Retained so late subscribers (the view tree applies its config before
    // this plugin finishes connecting) learn the render host is reachable and
    // replay their surface commands.
    context.effect(() => bus.retain('render.connected', true))
  },
}

// RenderHostClient speaks the surface.* command protocol. Methods mirror the
// render host's control API one to one.
export class RenderHostClient {
  private buffer = ''
  private handler: (event: RenderEvent) => void = () => {}
  private readonly socket: Socket<undefined>

  constructor(socket: Socket<undefined>) {
    this.socket = socket
  }

  onEvent(handler: (event: RenderEvent) => void): void {
    this.handler = handler
  }

  createSurface(spec: SurfaceSpec): void {
    const command: Record<string, unknown> = {
      cmd: 'surface.create',
      role: spec.role,
      url: spec.url,
      monitor: stringOrEmpty(spec.monitor),
      layer: spec.layer,
      anchors: spec.anchors,
      keyboard: spec.keyboard,
      width: numberOrZero(spec.width),
      height: numberOrZero(spec.height),
    }
    if (spec.exclusiveEdge !== undefined) {
      command.exclusive_edge = spec.exclusiveEdge
      command.exclusive_size = numberOrZero(spec.exclusiveSize)
    } else if (spec.exclusiveSize !== undefined) {
      // Edge-less negative size = ignore other surfaces' exclusive zones.
      command.exclusive_size = spec.exclusiveSize
    }
    this.send(command)
  }

  setExclusive(role: string, edge: string, size: number): void {
    this.send({ cmd: 'surface.exclusive', role, edge, size })
  }

  setInputRegion(role: string, rects: InputRect[]): void {
    this.send({ cmd: 'surface.region', role, rects })
  }

  setKeyboard(role: string, mode: string): void {
    this.send({ cmd: 'surface.keyboard', role, keyboard: mode })
  }

  show(role: string): void {
    this.send({ cmd: 'surface.show', role })
  }

  hide(role: string): void {
    this.send({ cmd: 'surface.hide', role })
  }

  destroy(role: string): void {
    this.send({ cmd: 'surface.destroy', role })
  }

  startDrag(paths: string[]): void {
    this.send({ cmd: 'surface.startdrag', paths })
  }

  close(): void {
    this.socket.end()
  }

  feed(chunk: string): void {
    this.buffer += chunk
    const parts = this.buffer.split('\n')
    this.buffer = parts[parts.length - 1]
    for (const line of parts.slice(0, -1)) {
      this.handleEventLine(line)
    }
  }

  private handleEventLine(line: string): void {
    if (line.trim() === '') {
      return
    }
    const event = parseRenderEvent(line)
    if (event === null) {
      return
    }
    this.handler(event)
  }

  private send(command: Record<string, unknown>): void {
    this.socket.write(JSON.stringify(command) + '\n')
  }
}

// spawnRenderHost starts the binary in its own process group so disposal can
// signal the whole group — WebKit forks web/network subprocesses that must not
// orphan a mapped layer surface.
function spawnRenderHost(binaryPath: string): () => void {
  const child = spawn(binaryPath, [], { detached: true, stdio: 'inherit' })
  return () => {
    killProcessGroup(child.pid)
  }
}

function killProcessGroup(pid: number | undefined): void {
  if (pid === undefined) {
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // already gone
  }
}

async function connectWithRetry(socketPath: string, timeoutMs: number): Promise<RenderHostClient> {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const client = await tryConnect(socketPath)
    if (client !== null) {
      return client
    }
    if (Date.now() >= deadline) {
      throw new Error(`render host socket ${socketPath} not reachable after ${timeoutMs}ms`)
    }
    await Bun.sleep(100)
  }
}

async function tryConnect(socketPath: string): Promise<RenderHostClient | null> {
  const box: { client: RenderHostClient | null } = { client: null }
  try {
    const socket = await Bun.connect<undefined>({
      unix: socketPath,
      socket: {
        data(_socket, chunk) {
          feedClient(box, chunk)
        },
      },
    })
    box.client = new RenderHostClient(socket)
    return box.client
  } catch {
    return null
  }
}

function feedClient(box: { client: RenderHostClient | null }, chunk: Buffer): void {
  if (box.client === null) {
    return
  }
  box.client.feed(chunk.toString())
}

function parseRenderEvent(line: string): RenderEvent | null {
  try {
    return JSON.parse(line) as RenderEvent
  } catch (error) {
    console.error('host: bad render event:', error)
    return null
  }
}

function stringOrEmpty(value: string | undefined): string {
  if (value === undefined) {
    return ''
  }
  return value
}

function numberOrZero(value: number | undefined): number {
  if (value === undefined) {
    return 0
  }
  return value
}
