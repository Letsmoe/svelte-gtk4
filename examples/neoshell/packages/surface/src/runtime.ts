import { Context, FiberState } from '@neoworks/extension-system'
import type { Fiber, Plugin } from '@neoworks/extension-system'
import { BusClient } from './busClient.js'
import { ViewRegistry } from './viewRegistry.js'

// SurfaceRuntime is the webview end of the remote-fiber bridge. It runs the
// same kernel as the host and executes the host's mount/dispose commands:
//
//   host → surface   surface.<id>.mount    {fiber, url, config}
//   surface          import(url); root.plugin(module)
//   surface → host   surface.<id>.state    {fiber, state}
//   host → surface   surface.<id>.dispose  {fiber}
//
// On boot it announces surface.<id>.ready as a retained topic; the retained
// value dies with the WebSocket connection, so host-side readiness tracks
// webview liveness for free.

export interface SurfaceRuntimeOptions {
  surfaceId: string
  busUrl: string
  // Overrides module loading; defaults to native dynamic import, which the
  // webview resolves over HTTP. Non-browser embedders (tests) inject a loader
  // that fetches by other means.
  loadModule?: (url: string) => Promise<unknown>
}

interface MountCommand {
  fiber: string
  url: string
  config?: unknown
}

interface DisposeCommand {
  fiber: string
}

// The bridge reports fiber states as the names the host's RemoteView tracks,
// so the wire protocol does not carry the kernel's numeric enum.
const STATE_NAMES: Record<FiberState, string> = {
  [FiberState.PENDING]: 'pending',
  [FiberState.LOADING]: 'pending',
  [FiberState.ACTIVE]: 'active',
  [FiberState.FAILED]: 'failed',
  [FiberState.UNLOADING]: 'active',
  [FiberState.DISPOSED]: 'disposed',
}

export class SurfaceRuntime {
  readonly root = new Context()
  readonly bus: BusClient
  readonly views = new ViewRegistry()
  private readonly surfaceId: string
  private readonly fibers = new Map<string, Fiber>()
  private readonly loadModule: (url: string) => Promise<unknown>

  constructor(options: SurfaceRuntimeOptions) {
    this.surfaceId = options.surfaceId
    this.bus = new BusClient(options.busUrl, options.surfaceId)
    this.loadModule = moduleLoaderOf(options)
  }

  async start(): Promise<void> {
    await this.bus.connect()
    await this.root.plugin(surfaceServicesPlugin(this.bus, this.views))

    const prefix = `surface.${this.surfaceId}`
    this.bus.subscribe(`${prefix}.mount`, (message) => {
      void this.handleMount(message.data as MountCommand)
    })
    this.bus.subscribe(`${prefix}.dispose`, (message) => {
      void this.handleDispose(message.data as DisposeCommand)
    })
    this.bus.retain(`${prefix}.ready`, true)
  }

  async stop(): Promise<void> {
    await this.root.fiber.dispose()
    this.bus.close()
  }

  private async handleMount(command: MountCommand): Promise<void> {
    if (this.fibers.has(command.fiber)) {
      return
    }
    const plugin = await loadViewPlugin(command.url, this.loadModule)
    if (plugin === null) {
      this.reportState(command.fiber, 'failed')
      return
    }
    const fiber = this.root.plugin(plugin, command.config)
    this.fibers.set(command.fiber, fiber)
    await settled(fiber)
    this.reportState(command.fiber, STATE_NAMES[fiber.state])
  }

  private async handleDispose(command: DisposeCommand): Promise<void> {
    const fiber = this.fibers.get(command.fiber)
    if (fiber === undefined) {
      this.reportState(command.fiber, 'disposed')
      return
    }
    await fiber.dispose()
    this.fibers.delete(command.fiber)
    this.reportState(command.fiber, 'disposed')
  }

  private reportState(fiberId: string, state: string): void {
    this.bus.publish(`surface.${this.surfaceId}.state`, { fiber: fiberId, state })
  }
}

// surfaceServicesPlugin publishes the two services every view plugin builds
// on: the bus connection and the view registry.
function surfaceServicesPlugin(bus: BusClient, views: ViewRegistry): Plugin.Object {
  return {
    name: 'surface-services',
    apply(context) {
      context.provide('bus', bus)
      context.provide('ui', views)
    },
  }
}

// A view plugin that throws leaves its fiber failed, and the state report is
// how the host learns that — so the rejection is awaited, not propagated.
async function settled(fiber: PromiseLike<unknown>): Promise<void> {
  try {
    await fiber
  } catch {
    // reported through the fiber's state
  }
}

function moduleLoaderOf(options: SurfaceRuntimeOptions): (url: string) => Promise<unknown> {
  if (options.loadModule !== undefined) {
    return options.loadModule
  }
  return (url) => import(url)
}

async function loadViewPlugin(
  url: string,
  loadModule: (url: string) => Promise<unknown>,
): Promise<Plugin.Object | null> {
  let module: Record<string, unknown>
  try {
    module = (await loadModule(url)) as Record<string, unknown>
  } catch (error) {
    console.error(`surface: failed to load view module ${url}:`, error)
    return null
  }
  const plugin = pickPlugin(module)
  if (plugin === null) {
    console.error(`surface: module ${url} exports no plugin (need default export or apply)`)
  }
  return plugin
}

function pickPlugin(module: Record<string, unknown>): Plugin.Object | null {
  if (isPlugin(module.default)) {
    return module.default
  }
  if (isPlugin(module)) {
    return module
  }
  return null
}

function isPlugin(value: unknown): value is Plugin.Object {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  return typeof (value as Plugin.Object).apply === 'function'
}
