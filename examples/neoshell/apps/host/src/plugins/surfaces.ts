import type { Plugin } from '@neoworks/extension-system'
import { requireService } from '../services.js'
import type { Bus, BusMessage } from '../bus.js'

// surfacesPlugin is the host end of the remote-fiber bridge. Extensions mount
// their view halves into webviews through the "surfaces" service; the actual
// execution site is a SurfaceRuntime (packages/surface) at the far end of the
// WebSocket. Desired mounts are re-sent whenever a surface announces ready, so
// a reloaded webview reconstructs its views without anyone noticing.

export interface RemoteViewSpec {
  url: string
  config?: unknown
}

export type RemoteViewState = 'pending' | 'active' | 'failed' | 'disposed'

export const surfacesPlugin: Plugin.Object = {
  name: 'surfaces',
  inject: ['bus'],
  apply(context) {
    const bus = requireService<Bus>(context, 'bus')
    const service = new SurfacesService(bus)
    context.effect(() => service.listen())
    context.provide('surfaces', service)
  },
}

// RemoteView is an extension's handle on one mounted view half. dispose()
// resolves when the surface confirms teardown — or after a short timeout, in
// which case the webview is gone and its whole context died with it.
export class RemoteView {
  state: RemoteViewState = 'pending'
  readonly fiberId: string
  readonly surfaceId: string
  private readonly service: SurfacesService
  private disposedWaiters: Array<() => void> = []

  constructor(service: SurfacesService, surfaceId: string, fiberId: string) {
    this.service = service
    this.surfaceId = surfaceId
    this.fiberId = fiberId
  }

  dispose(): Promise<void> {
    return this.service.disposeView(this)
  }

  notifyState(state: RemoteViewState): void {
    this.state = state
    if (state !== 'disposed') {
      return
    }
    for (const waiter of this.disposedWaiters) {
      waiter()
    }
    this.disposedWaiters = []
  }

  waitDisposed(timeoutMs: number): Promise<void> {
    if (this.state === 'disposed') {
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.disposedWaiters.push(resolve)
      setTimeout(resolve, timeoutMs)
    })
  }
}

interface DesiredView {
  surfaceId: string
  fiberId: string
  spec: RemoteViewSpec
  view: RemoteView
}

export class SurfacesService {
  private readonly bus: Bus
  private nextFiberId = 1
  private readonly desired = new Map<string, DesiredView>()
  private readonly readySurfaces = new Set<string>()

  constructor(bus: Bus) {
    this.bus = bus
  }

  listen(): () => void {
    return this.bus.subscribe('surface.*', (message) => {
      this.handleMessage(message)
    })
  }

  mount(surfaceId: string, spec: RemoteViewSpec): RemoteView {
    const fiberId = `f${this.nextFiberId}`
    this.nextFiberId += 1
    const view = new RemoteView(this, surfaceId, fiberId)
    this.desired.set(fiberId, { surfaceId, fiberId, spec, view })
    if (this.readySurfaces.has(surfaceId)) {
      this.sendMount(surfaceId, fiberId, spec)
    }
    return view
  }

  async disposeView(view: RemoteView): Promise<void> {
    if (view.state === 'disposed') {
      this.desired.delete(view.fiberId)
      return
    }
    if (!this.readySurfaces.has(view.surfaceId)) {
      this.desired.delete(view.fiberId)
      view.notifyState('disposed')
      return
    }
    this.bus.publish(`surface.${view.surfaceId}.dispose`, { fiber: view.fiberId })
    await view.waitDisposed(2000)
    view.notifyState('disposed')
    this.desired.delete(view.fiberId)
  }

  private handleMessage(message: BusMessage): void {
    const parts = message.type.split('.')
    if (parts.length < 3 || parts[0] !== 'surface') {
      return
    }
    if (parts[2] === 'ready') {
      this.handleReady(parts[1])
      return
    }
    if (parts[2] === 'state') {
      this.handleState(message.data)
    }
  }

  // handleReady re-sends every desired mount for the surface: first boot and
  // webview reload look identical from here.
  private handleReady(surfaceId: string): void {
    this.readySurfaces.add(surfaceId)
    for (const entry of this.desired.values()) {
      this.sendMountIfSurface(entry, surfaceId)
    }
  }

  private sendMountIfSurface(entry: DesiredView, surfaceId: string): void {
    if (entry.surfaceId !== surfaceId) {
      return
    }
    this.sendMount(entry.surfaceId, entry.fiberId, entry.spec)
  }

  private sendMount(surfaceId: string, fiberId: string, spec: RemoteViewSpec): void {
    this.bus.publish(`surface.${surfaceId}.mount`, {
      fiber: fiberId,
      url: spec.url,
      config: spec.config,
    })
  }

  private handleState(data: unknown): void {
    const report = data as { fiber?: string; state?: RemoteViewState }
    if (typeof report.fiber !== 'string' || typeof report.state !== 'string') {
      return
    }
    const entry = this.desired.get(report.fiber)
    if (entry === undefined) {
      return
    }
    entry.view.notifyState(report.state)
  }
}
