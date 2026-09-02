import { join } from 'node:path'
import type { Context, Plugin } from '@neoworks/extension-system'
import { optionalService, requireService } from '../services.js'
import type { Bus, BusMessage } from '../bus.js'
import type { HttpService } from './http.js'
import type { SurfacesService, RemoteView } from './surfaces.js'
import { widgetExtensionIds } from './extensions.js'

// viewTreePlugin turns the config view tree into a running desktop:
//
//  - one webview per layer-shell layer that any top-level entry uses; layers
//    nothing uses get no surface (and are destroyed when they empty out)
//  - a top-level entry's args position it inside its layer webview (the
//    surface runtime renders it into an anchored wrapper) and, when it
//    declares an exclusive zone, spawn a contentless reservation surface —
//    the layer webview itself is full-screen and reserves nothing
//  - each layer webview starts fully click-through; the surface runtime
//    reports the occupied rects on surface.<layer>.input and the host
//    forwards them as the wayland input region
//  - the resolved tree is the retained "views" topic surfaces render from
//  - every extension whose view types appear in a layer's subtrees gets its
//    views module mounted into that layer's webview (remote fibers)

export interface ViewTreeConfig {
  extensionsDir: string
  // Dev only: the vite dev server origin serving <id>/src/views.ts. Set, the
  // webviews import their views from there and take updates over HMR; unset,
  // they import the built bundles the host serves under /plugins/<id>/.
  viewsDevOrigin?: string
}

interface TreeNode {
  id?: string
  type: string
  args?: Record<string, unknown>
  children?: TreeNode[]
}

interface InputRect {
  x: number
  y: number
  w: number
  h: number
}

// RenderHostLike is the optional renderhost service — absent when the render
// host is not owned by this process (tests, migration).
interface RenderHostLike {
  createSurface(spec: Record<string, unknown>): void
  destroy(role: string): void
  setInputRegion(role: string, rects: InputRect[]): void
}

const LAYERS = new Set(['background', 'bottom', 'top', 'overlay'])
const KEYBOARD_RANK: Record<string, number> = { none: 0, ondemand: 1, exclusive: 2 }

// The neoworks default profile: bar, dock, wallpaper. Ordinary config — a
// user's "views" key replaces it wholesale.
const DEFAULT_TREE: TreeNode[] = [
  {
    id: 'bar',
    type: 'neoshell.topbar',
    args: {
      layer: 'top',
      anchors: ['top', 'left', 'right'],
      keyboard: 'ondemand',
      height: 30,
      exclusiveEdge: 'top',
      exclusiveSize: 30,
      centerGap: 320,
      blur: true,
    },
    children: [
      { type: 'systray.indicator' },
      { type: 'vpn.indicator' },
      { type: 'neoshell.battery' },
      { type: 'neoshell.clock' },
    ],
  },
  {
    id: 'notch',
    type: 'neoshell.notch',
    // No size: the wrapper hugs the island so the reported input region grows
    // and shrinks with it. Listed after the bar, so it paints over it.
    args: {
      layer: 'top',
      anchors: ['top'],
      align: 'center',
      keyboard: 'none',
    },
  },
  {
    id: 'quicksettings',
    type: 'quicksettings.panel',
    // No size and one anchor: the wrapper collapses to nothing, so a closed
    // tray neither reserves input nor covers the views under it. The panel
    // positions its own scrim with fixed coordinates when it opens.
    args: {
      layer: 'top',
      anchors: ['top'],
      keyboard: 'ondemand',
      top: 36,
    },
  },
  {
    id: 'systraymenu',
    type: 'systray.menu',
    // Same collapsed-wrapper trick as the quick settings tray: a tray item's
    // menu is taller than the bar it hangs from, so it needs a wrapper over the
    // whole output, and a closed one must reserve nothing.
    args: {
      layer: 'top',
      anchors: ['top'],
      keyboard: 'ondemand',
    },
  },
  {
    id: 'dock',
    type: 'neoshell.dock',
    args: {
      layer: 'top',
      anchors: ['bottom', 'left', 'right'],
      keyboard: 'none',
      height: 76,
      reveal: 'hover',
      revealSize: 4,
      blur: true,
    },
  },
  {
    id: 'desktop',
    type: 'neoshell.desktop',
    // Which widgets the desktop shows is config's answer, under widgets.<id>.
    // This list only seeds a desktop that has never been arranged: once
    // anything is written the seed is never consulted again, so removing a
    // widget in the gallery makes it stay removed.
    args: {
      layer: 'background',
      anchors: ['top', 'bottom', 'left', 'right'],
      // Widgets have their own settings now, and a text field on a layer that
      // takes no keyboard focus cannot be typed into.
      keyboard: 'ondemand',
      widgetHost: true,
      widgets: [
        { id: 'weather', type: 'weather.card', size: 'small' },
        { id: 'airquality', type: 'airquality.card', size: 'small' },
      ],
    },
  },
  {
    id: 'deskminder',
    // Behind application windows, like the desktop it sits on. No size and one
    // anchor, so the wrapper collapses and the pill positions itself: the
    // background layer then reserves only the pill's own rectangle and the
    // desktop under it keeps its clicks.
    type: 'deskminder.pill',
    args: {
      layer: 'background',
      anchors: ['top'],
      keyboard: 'ondemand',
    },
  },
  {
    id: 'widgetgallery',
    type: 'neoshell.widgetgallery',
    // Same collapsed-wrapper trick as the quick settings tray: no size and one
    // anchor, so a closed gallery reserves nothing and covers nothing. The
    // panel positions its own scrim when it opens.
    args: {
      layer: 'top',
      anchors: ['bottom'],
      keyboard: 'ondemand',
      widgetHost: true,
    },
  },
  {
    id: 'reminderalert',
    type: 'deskminder.alert',
    // Last in the tree, so a reminder going off paints over the bar and the
    // dock. It shares the top layer rather than opening an overlay webview of
    // its own: a second WebKit instance for a surface that is empty almost
    // always is not worth covering fullscreen windows.
    args: {
      layer: 'top',
      anchors: ['top'],
      keyboard: 'ondemand',
    },
  },
]

export const viewTreePlugin: Plugin.Object<ViewTreeConfig> = {
  name: 'view-tree',
  inject: ['bus', 'config', 'surfaces', 'http'],
  apply(context, config) {
    const bus = requireService<Bus>(context, 'bus')
    const http = requireService<HttpService>(context, 'http')
    const surfaces = requireService<SurfacesService>(context, 'surfaces')
    const manager = new ViewTreeManager(
      context,
      bus,
      surfaces,
      http.port,
      config.extensionsDir,
      originOf(config.viewsDevOrigin),
    )
    context.effect(() => {
      const unsubscribeConfig = bus.subscribe('config', (message) => {
        manager.applyFromSnapshot(message.data)
      })
      const unsubscribeInput = bus.subscribe('surface.*', (message) => {
        manager.handleSurfaceMessage(message)
      })
      const unsubscribeConnected = bus.subscribe('render.connected', () => {
        manager.handleRenderHostConnected()
      })
      const unsubscribeHot = bus.subscribe('hot.views', (message) => {
        manager.reloadViews(extensionIdOf(message.data))
      })
      return async () => {
        unsubscribeConfig()
        unsubscribeInput()
        unsubscribeConnected()
        unsubscribeHot()
        await manager.teardown()
      }
    })
  },
}

// SurfacePlan is one render-host surface the current tree wants: either a
// layer webview or a contentless exclusive-zone reservation. The signature
// detects spec changes that require a destroy + recreate.
interface SurfacePlan {
  role: string
  signature: string
  spec: Record<string, unknown>
  isWebview: boolean
  blur: boolean
}

class ViewTreeManager {
  private readonly context: Context
  private readonly bus: Bus
  private readonly surfaces: SurfacesService
  private readonly port: number
  private readonly extensionsDir: string
  private readonly viewsDevOrigin: string
  // desiredPlans is what the current tree wants; sentSurfaces is what the
  // render host actually received (empty while it is still connecting — a
  // render.connected message replays the difference).
  private desiredPlans = new Map<string, SurfacePlan>()
  private readonly sentSurfaces = new Map<string, string>()
  private readonly lastInputRects = new Map<string, InputRect[]>()
  private readonly mountedViews = new Map<string, RemoteView>()
  private clearRetained: () => void = () => {}
  private lastSignature = ''
  private lastTree: TreeNode[] = []
  private viewsGeneration = 0
  private queue: Promise<void> = Promise.resolve()

  constructor(
    context: Context,
    bus: Bus,
    surfaces: SurfacesService,
    port: number,
    extensionsDir: string,
    viewsDevOrigin: string,
  ) {
    this.context = context
    this.bus = bus
    this.surfaces = surfaces
    this.port = port
    this.extensionsDir = extensionsDir
    this.viewsDevOrigin = viewsDevOrigin
  }

  applyFromSnapshot(snapshot: unknown): void {
    const tree = treeOf(snapshot)
    const monitor = monitorOf(snapshot)
    this.queue = this.queue.then(() => this.applyTree(tree, monitor)).catch(logApplyError)
  }

  // reloadViews drops one extension's view module out of every layer webview
  // and mounts it again under a bumped version, since the webview caches a
  // module URL it has already imported.
  reloadViews(extensionId: string): void {
    if (extensionId === '') {
      return
    }
    this.queue = this.queue.then(() => this.remountViews(extensionId)).catch(logApplyError)
  }

  private async remountViews(extensionId: string): Promise<void> {
    this.viewsGeneration += 1
    for (const [key, view] of [...this.mountedViews]) {
      await this.disposeIfExtension(key, view, extensionId)
    }
    await this.syncViewMounts(this.lastTree)
  }

  private async disposeIfExtension(
    key: string,
    view: RemoteView,
    extensionId: string,
  ): Promise<void> {
    if (!key.endsWith(`:${extensionId}`)) {
      return
    }
    await view.dispose()
    this.mountedViews.delete(key)
  }

  settle(): Promise<void> {
    return this.queue
  }

  handleSurfaceMessage(message: BusMessage): void {
    const layer = inputTopicLayer(message.type)
    if (layer === null || !this.desiredPlans.has(layer)) {
      return
    }
    const rects = inputRectsOf(message.data)
    this.lastInputRects.set(layer, rects)
    const renderHost = optionalService<RenderHostLike>(this.context, 'renderhost')
    if (renderHost !== undefined) {
      renderHost.setInputRegion(layer, rects)
    }
  }

  // The render host finished connecting (possibly after the tree was already
  // applied): nothing sent so far reached it, so replay everything.
  handleRenderHostConnected(): void {
    this.sentSurfaces.clear()
    this.syncSurfaces()
    this.resendInputRects()
  }

  async teardown(): Promise<void> {
    await this.queue
    for (const [, view] of this.mountedViews) {
      await view.dispose()
    }
    this.mountedViews.clear()
    this.desiredPlans = new Map()
    this.syncSurfaces()
    this.clearRetained()
  }

  private async applyTree(tree: TreeNode[], monitor: string): Promise<void> {
    const signature = JSON.stringify({ tree, monitor })
    if (signature === this.lastSignature) {
      return
    }
    this.lastSignature = signature
    this.lastTree = tree

    this.clearRetained()
    this.clearRetained = this.bus.retain('views', tree)

    this.desiredPlans = planSurfaces(tree, this.port, monitor)
    this.syncSurfaces()
    await this.syncViewMounts(tree)
  }

  private syncSurfaces(): void {
    const renderHost = optionalService<RenderHostLike>(this.context, 'renderhost')
    if (renderHost === undefined) {
      return
    }
    for (const [role, signature] of [...this.sentSurfaces]) {
      this.destroyIfStale(renderHost, role, signature)
    }
    for (const plan of this.desiredPlans.values()) {
      this.createIfMissing(renderHost, plan)
    }
  }

  private destroyIfStale(renderHost: RenderHostLike, role: string, signature: string): void {
    const plan = this.desiredPlans.get(role)
    if (plan !== undefined && plan.signature === signature) {
      return
    }
    this.sentSurfaces.delete(role)
    renderHost.destroy(role)
  }

  private createIfMissing(renderHost: RenderHostLike, plan: SurfacePlan): void {
    if (this.sentSurfaces.has(plan.role)) {
      return
    }
    this.sentSurfaces.set(plan.role, plan.signature)
    renderHost.createSurface(plan.spec)
    if (plan.isWebview) {
      renderHost.setInputRegion(plan.role, [])
    }
    if (plan.blur) {
      this.applyBlurRules(plan.role)
    }
  }

  private resendInputRects(): void {
    const renderHost = optionalService<RenderHostLike>(this.context, 'renderhost')
    if (renderHost === undefined) {
      return
    }
    for (const [layer, rects] of this.lastInputRects) {
      if (this.desiredPlans.has(layer)) {
        renderHost.setInputRegion(layer, rects)
      }
    }
  }

  private applyBlurRules(role: string): void {
    this.bus.publish('hypr:keyword', { name: 'layerrule', value: `blur,neoshell.${role}` })
    this.bus.publish('hypr:keyword', {
      name: 'layerrule',
      value: `ignorealpha 0.1,neoshell.${role}`,
    })
  }

  // syncViewMounts mounts each referenced extension's views module into each
  // layer webview that uses it, keyed layer:extension, and disposes mounts the
  // tree no longer needs.
  private async syncViewMounts(tree: TreeNode[]): Promise<void> {
    const desired = new Map<string, { surfaceId: string; url: string }>()
    for (const node of tree) {
      await this.collectMounts(node, desired)
    }
    for (const [key, view] of [...this.mountedViews]) {
      await this.disposeIfUnwanted(key, view, desired)
    }
    for (const [key, mount] of desired) {
      this.mountIfMissing(key, mount)
    }
  }

  private async collectMounts(
    node: TreeNode,
    desired: Map<string, { surfaceId: string; url: string }>,
  ): Promise<void> {
    const layer = layerOf(node)
    for (const extensionId of this.extensionIdsFor(node)) {
      const url = await this.viewsUrlOf(extensionId)
      if (url === null) {
        continue
      }
      desired.set(`${layer}:${extensionId}`, { surfaceId: layer, url })
    }
  }

  // A widget host mounts every widget provider, not just the types its subtree
  // names: which widgets it shows is config's answer and the gallery's, and a
  // provider whose views were never loaded resolves to nothing at all.
  private extensionIdsFor(node: TreeNode): Set<string> {
    const ids = extensionIdsIn(node)
    if (!hostsWidgets(node)) {
      return ids
    }
    for (const extensionId of widgetExtensionIds(this.extensionsDir)) {
      ids.add(extensionId)
    }
    return ids
  }

  private async viewsUrlOf(extensionId: string): Promise<string | null> {
    const manifestPath = join(this.extensionsDir, extensionId, 'manifest.json')
    let manifest: { views?: string }
    try {
      manifest = (await Bun.file(manifestPath).json()) as { views?: string }
    } catch {
      return null
    }
    if (manifest.views === undefined || manifest.views === '') {
      return null
    }
    if (this.viewsDevOrigin !== '') {
      return `${this.viewsDevOrigin}/${extensionId}/src/views.ts`
    }
    return `http://127.0.0.1:${this.port}/plugins/${extensionId}/${manifest.views}`
  }

  private async disposeIfUnwanted(
    key: string,
    view: RemoteView,
    desired: Map<string, unknown>,
  ): Promise<void> {
    if (desired.has(key)) {
      return
    }
    await view.dispose()
    this.mountedViews.delete(key)
  }

  private mountIfMissing(key: string, mount: { surfaceId: string; url: string }): void {
    if (this.mountedViews.has(key)) {
      return
    }
    const url = this.versionedUrl(mount.url)
    this.mountedViews.set(key, this.surfaces.mount(mount.surfaceId, { url }))
  }

  // The webview caches every module URL it has already imported, so a remount
  // needs a fresh one. The dev server has no stale copy to bust, and a query
  // on a source path is a different module to vite.
  private versionedUrl(url: string): string {
    if (this.viewsDevOrigin !== '') {
      return url
    }
    return `${url}?g=${this.viewsGeneration}`
  }
}

// planSurfaces derives the desired render-host surfaces from the tree: one
// full-screen webview per used layer plus one reservation surface per
// exclusive-zone node. An empty monitor leaves the output to the render host,
// which takes the first one the compositor advertises.
function planSurfaces(tree: TreeNode[], port: number, monitor: string): Map<string, SurfacePlan> {
  const plans = new Map<string, SurfacePlan>()
  for (const [layer, nodes] of groupByLayer(tree)) {
    addWebviewPlan(plans, layer, nodes, port, monitor)
    for (const node of nodes) {
      addReservationPlan(plans, layer, node, monitor)
    }
  }
  return plans
}

function addWebviewPlan(
  plans: Map<string, SurfacePlan>,
  layer: string,
  nodes: TreeNode[],
  port: number,
  monitor: string,
): void {
  const spec: Record<string, unknown> = {
    role: layer,
    url: `http://127.0.0.1:${port}/surface?surface=${layer}`,
    monitor,
    layer,
    anchors: ['top', 'bottom', 'left', 'right'],
    keyboard: maxKeyboard(nodes),
    // Span the full output — never pushed inward by the exclusive-zone
    // reservations (which exist for regular application windows).
    exclusiveSize: -1,
  }
  plans.set(layer, {
    role: layer,
    signature: JSON.stringify(spec),
    spec,
    isWebview: true,
    blur: nodes.some((node) => argsOf(node).blur === true),
  })
}

function addReservationPlan(
  plans: Map<string, SurfacePlan>,
  layer: string,
  node: TreeNode,
  monitor: string,
): void {
  const args = argsOf(node)
  const edge = args.exclusiveEdge
  const size = args.exclusiveSize
  if (typeof edge !== 'string' || typeof size !== 'number' || size <= 0) {
    return
  }
  if (node.id === undefined || node.id === '') {
    console.error(`view-tree: exclusive-zone node "${node.type}" has no id, zone skipped`)
    return
  }
  const role = `reserve.${node.id}`
  const spec: Record<string, unknown> = {
    role,
    url: '',
    monitor,
    layer,
    anchors: reservationAnchors(edge),
    keyboard: 'none',
    exclusiveEdge: edge,
    exclusiveSize: size,
  }
  plans.set(role, {
    role,
    signature: JSON.stringify(spec),
    spec,
    isWebview: false,
    blur: false,
  })
}

function reservationAnchors(edge: string): string[] {
  if (edge === 'top' || edge === 'bottom') {
    return [edge, 'left', 'right']
  }
  return [edge, 'top', 'bottom']
}

function groupByLayer(tree: TreeNode[]): Map<string, TreeNode[]> {
  const groups = new Map<string, TreeNode[]>()
  for (const node of tree) {
    const layer = layerOf(node)
    const nodes = groups.get(layer)
    if (nodes === undefined) {
      groups.set(layer, [node])
      continue
    }
    nodes.push(node)
  }
  return groups
}

function layerOf(node: TreeNode): string {
  const layer = argsOf(node).layer
  if (typeof layer === 'string' && LAYERS.has(layer)) {
    return layer
  }
  return 'top'
}

function maxKeyboard(nodes: TreeNode[]): string {
  let best = 'none'
  for (const node of nodes) {
    const keyboard = argsOf(node).keyboard
    if (typeof keyboard !== 'string' || KEYBOARD_RANK[keyboard] === undefined) {
      continue
    }
    if (KEYBOARD_RANK[keyboard] > KEYBOARD_RANK[best]) {
      best = keyboard
    }
  }
  return best
}

function inputTopicLayer(topic: string): string | null {
  const match = /^surface\.([^.]+)\.input$/.exec(topic)
  if (match === null) {
    return null
  }
  return match[1]
}

function inputRectsOf(data: unknown): InputRect[] {
  if (typeof data !== 'object' || data === null) {
    return []
  }
  const rects = (data as { rects?: unknown }).rects
  if (!Array.isArray(rects)) {
    return []
  }
  return rects.filter(isInputRect)
}

function isInputRect(value: unknown): value is InputRect {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const rect = value as InputRect
  return (
    typeof rect.x === 'number' &&
    typeof rect.y === 'number' &&
    typeof rect.w === 'number' &&
    typeof rect.h === 'number'
  )
}

function hostsWidgets(node: TreeNode): boolean {
  if (typeof node.args !== 'object' || node.args === null) {
    return false
  }
  return (node.args as Record<string, unknown>).widgetHost === true
}

// extensionIdsIn collects the namespace prefixes ("vpn" from "vpn.indicator")
// used anywhere in a node's subtree.
function extensionIdsIn(node: TreeNode): Set<string> {
  const ids = new Set<string>()
  collectExtensionIds(node, ids)
  return ids
}

function collectExtensionIds(node: TreeNode, ids: Set<string>): void {
  const dotIndex = node.type.indexOf('.')
  if (dotIndex > 0) {
    ids.add(node.type.slice(0, dotIndex))
  }
  if (node.children === undefined) {
    return
  }
  for (const child of node.children) {
    collectExtensionIds(child, ids)
  }
}

function treeOf(snapshot: unknown): TreeNode[] {
  if (typeof snapshot !== 'object' || snapshot === null) {
    return DEFAULT_TREE
  }
  const views = (snapshot as Record<string, unknown>).views
  if (!Array.isArray(views)) {
    return DEFAULT_TREE
  }
  return views.filter(isTreeNode)
}

// The config's "monitor" key names the wl_output the whole shell lives on.
function monitorOf(snapshot: unknown): string {
  if (typeof snapshot !== 'object' || snapshot === null) {
    return ''
  }
  const monitor = (snapshot as Record<string, unknown>).monitor
  if (typeof monitor !== 'string') {
    return ''
  }
  return monitor
}

function extensionIdOf(data: unknown): string {
  if (typeof data !== 'object' || data === null) {
    return ''
  }
  const id = (data as { id?: unknown }).id
  if (typeof id === 'string') {
    return id
  }
  return ''
}

function isTreeNode(value: unknown): value is TreeNode {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  return typeof (value as TreeNode).type === 'string'
}

function argsOf(node: TreeNode): Record<string, unknown> {
  if (node.args === undefined) {
    return {}
  }
  return node.args
}

// A trailing slash would double up in the module URLs built from it.
function originOf(configured: string | undefined): string {
  if (configured === undefined) {
    return ''
  }
  return configured.replace(/\/+$/, '')
}

function logApplyError(error: unknown): void {
  console.error('view-tree: apply failed:', error)
}
