import { renderTree } from './renderer.js'
import type { ViewNode } from './renderer.js'
import { SurfaceRuntime } from './runtime.js'

// bootSurface is the entry the host's /surface page runs. One webview exists
// per layer-shell layer, so ?surface= names a layer ("top", "background", …).
// The boot renders every top-level tree node assigned to that layer into its
// own positioned wrapper (the node's args carry anchors/size), and reports the
// wrappers' bounding rects as the surface's input region — everything outside
// them stays click-through.

interface TopLevelNode extends ViewNode {
  id?: string
  args?: Record<string, unknown>
}

const DEFAULT_REVEAL_SIZE = 4

export async function bootSurface(): Promise<SurfaceRuntime> {
  const params = new URLSearchParams(window.location.search)
  const layer = params.get('surface')
  if (layer === null || layer === '') {
    throw new Error('surface: missing ?surface= parameter')
  }
  const runtime = new SurfaceRuntime({
    surfaceId: layer,
    busUrl: `ws://${window.location.host}/ws`,
  })
  await runtime.start()
  followViewTree(runtime, layer, document.body)
  followRuntimeReloads(runtime)
  return runtime
}

// The host rebundles the runtime on change and announces it; the surface can
// only pick that up by reloading the page. Nothing publishes this topic unless
// hot reload is on.
function followRuntimeReloads(runtime: SurfaceRuntime): void {
  runtime.bus.subscribe('hot.surface', () => {
    window.location.reload()
  })
}

function followViewTree(runtime: SurfaceRuntime, layer: string, container: HTMLElement): void {
  const reporter = new InputRectReporter(runtime, layer)
  let disposeRendered = () => {}
  let currentNodes: TopLevelNode[] = []
  let rerenderTimer: ReturnType<typeof setTimeout> | null = null

  const rerender = () => {
    disposeRendered()
    disposeRendered = renderLayerNodes(container, currentNodes, runtime, reporter)
  }
  const scheduleRerender = () => {
    if (rerenderTimer !== null) {
      return
    }
    rerenderTimer = setTimeout(() => {
      rerenderTimer = null
      rerender()
    }, 16)
  }

  runtime.bus.subscribe('views', (message) => {
    currentNodes = nodesForLayer(message.data, layer)
    rerender()
  })
  runtime.views.onChange(scheduleRerender)
}

function renderLayerNodes(
  container: HTMLElement,
  nodes: TopLevelNode[],
  runtime: SurfaceRuntime,
  reporter: InputRectReporter,
): () => void {
  const disposers: Array<() => void> = []
  const wrappers: HTMLElement[] = []
  for (const node of nodes) {
    const wrapper = makeWrapper(node)
    container.appendChild(wrapper)
    const disposeTree = renderTree(wrapper, [node], runtime.views)
    wrappers.push(wrapper)
    disposers.push(() => {
      disposeTree()
      wrapper.remove()
    })
  }
  reporter.track(wrappers)
  return () => {
    for (const dispose of disposers.reverse()) {
      dispose()
    }
  }
}

function makeWrapper(node: TopLevelNode): HTMLElement {
  const wrapper = document.createElement('div')
  if (node.id !== undefined) {
    wrapper.dataset.surfaceNode = node.id
  }
  positionWrapper(wrapper, argsOf(node))
  return wrapper
}

// positionWrapper turns a top-level node's layer-shell-style args (anchors,
// width, height) into fixed CSS positioning inside the full-screen webview.
// display:grid stretches the rendered view to fill the wrapper.
export function positionWrapper(element: HTMLElement, args: Record<string, unknown>): void {
  const anchors = anchorsOf(args)
  element.style.position = 'fixed'
  element.style.display = 'grid'
  for (const edge of ['top', 'bottom', 'left', 'right']) {
    if (anchors.has(edge)) {
      element.style.setProperty(edge, '0')
    }
  }
  applySize(element, args, anchors)
  applyAlignment(element, args, anchors)
  applyHoverReveal(element, args, anchors)
}

// applyAlignment centers a node on every axis it is not stretched along, so a
// node that carries no size hugs its content and still sits on the output's
// centre line — what a notch-style view needs.
function applyAlignment(
  element: HTMLElement,
  args: Record<string, unknown>,
  anchors: Set<string>,
): void {
  if (args.align !== 'center') {
    return
  }
  const shifts: string[] = []
  if (!anchors.has('left') && !anchors.has('right')) {
    element.style.left = '50%'
    fitToContent(element, 'width')
    shifts.push('translateX(-50%)')
  }
  if (!anchors.has('top') && !anchors.has('bottom')) {
    element.style.top = '50%'
    fitToContent(element, 'height')
    shifts.push('translateY(-50%)')
  }
  element.style.transform = shifts.join(' ')
}

// A fixed node anchored on one edge only has to shrink-wrap for the centring
// shift to land, and for the reported input rect to stay tight around the
// content. Stating it beats relying on the auto-width inference.
function fitToContent(element: HTMLElement, axis: 'width' | 'height'): void {
  if (element.style.getPropertyValue(axis) !== '') {
    return
  }
  element.style.setProperty(axis, 'max-content')
}

function applySize(element: HTMLElement, args: Record<string, unknown>, anchors: Set<string>): void {
  const width = args.width
  const height = args.height
  if (typeof height === 'number' && !(anchors.has('top') && anchors.has('bottom'))) {
    element.style.height = `${height}px`
  }
  if (typeof width === 'number' && !(anchors.has('left') && anchors.has('right'))) {
    element.style.width = `${width}px`
  }
}

// applyHoverReveal collapses a node to a thin hot strip along its anchored
// edge until the pointer enters it. Only the strip lands in the surface's
// input region, so the rest of the edge stays click-through; entering restores
// the configured size and the ResizeObserver reports the wider region.
function applyHoverReveal(
  element: HTMLElement,
  args: Record<string, unknown>,
  anchors: Set<string>,
): void {
  if (args.reveal !== 'hover') {
    return
  }
  const axis = revealAxis(anchors)
  const expanded = element.style.getPropertyValue(axis)
  if (expanded === '') {
    console.error('surface: hover reveal needs an explicit size, node stays expanded')
    return
  }
  const collapsed = `${revealSizeOf(args)}px`
  element.style.setProperty(axis, collapsed)
  element.addEventListener('pointerenter', () => {
    element.style.setProperty(axis, expanded)
  })
  element.addEventListener('pointerleave', () => {
    element.style.setProperty(axis, collapsed)
  })
}

function revealAxis(anchors: Set<string>): 'height' | 'width' {
  if (anchors.has('left') && anchors.has('right')) {
    return 'height'
  }
  return 'width'
}

function revealSizeOf(args: Record<string, unknown>): number {
  if (typeof args.revealSize === 'number' && args.revealSize > 0) {
    return args.revealSize
  }
  return DEFAULT_REVEAL_SIZE
}

function anchorsOf(args: Record<string, unknown>): Set<string> {
  if (!Array.isArray(args.anchors)) {
    return new Set(['top', 'bottom', 'left', 'right'])
  }
  return new Set(args.anchors.filter((value) => typeof value === 'string'))
}

// nodesForLayer picks this webview's top-level entries out of the published
// tree: every node whose args.layer matches (missing layer defaults to "top").
export function nodesForLayer(tree: unknown, layer: string): TopLevelNode[] {
  if (!Array.isArray(tree)) {
    return []
  }
  const nodes: TopLevelNode[] = []
  for (const candidate of tree as TopLevelNode[]) {
    if (isNode(candidate) && layerOf(candidate) === layer) {
      nodes.push(candidate)
    }
  }
  return nodes
}

function isNode(value: unknown): value is TopLevelNode {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  return typeof (value as TopLevelNode).type === 'string'
}

export function layerOf(node: TopLevelNode): string {
  const layer = argsOf(node).layer
  if (typeof layer === 'string' && layer !== '') {
    return layer
  }
  return 'top'
}

function argsOf(node: TopLevelNode): Record<string, unknown> {
  if (node.args === undefined) {
    return {}
  }
  return node.args
}

interface InputRect {
  x: number
  y: number
  w: number
  h: number
}

// InputRectReporter publishes the wrappers' bounding boxes on
// surface.<layer>.input whenever they change; the host forwards them to the
// render host as the surface's wayland input region.
class InputRectReporter {
  private readonly runtime: SurfaceRuntime
  private readonly layer: string
  private wrappers: HTMLElement[] = []
  private observer: ResizeObserver | null = null
  private mutations: MutationObserver | null = null
  private lastPayload = ''
  private pending = false

  constructor(runtime: SurfaceRuntime, layer: string) {
    this.runtime = runtime
    this.layer = layer
    window.addEventListener('resize', () => {
      this.schedule()
    })
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => {
        this.schedule()
      })
    }
    if (typeof MutationObserver !== 'undefined') {
      this.mutations = new MutationObserver(() => {
        this.schedule()
      })
    }
  }

  track(wrappers: HTMLElement[]): void {
    this.wrappers = wrappers
    this.observeWrappers()
    this.followTransitions()
    this.schedule()
  }

  // Revealing a view usually slides it into place, and a transform never trips
  // the ResizeObserver — the region is only correct once the slide lands.
  private followTransitions(): void {
    for (const wrapper of this.wrappers) {
      wrapper.addEventListener('transitionend', () => this.schedule())
    }
  }

  private observeWrappers(): void {
    this.observeSizes()
    this.observeContent()
  }

  private observeSizes(): void {
    if (this.observer === null) {
      return
    }
    this.observer.disconnect()
    for (const wrapper of this.wrappers) {
      this.observer.observe(wrapper)
    }
  }

  // A panel that opens inside a collapsed wrapper — a tray, the widget gallery
  // — changes no wrapper's size, so the ResizeObserver never fires and the
  // surface would keep the input region it had while closed: the panel would
  // render and take no clicks. Watching the subtree is what catches it.
  private observeContent(): void {
    if (this.mutations === null) {
      return
    }
    this.mutations.disconnect()
    for (const wrapper of this.wrappers) {
      this.mutations.observe(wrapper, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'data-input-region'],
      })
    }
  }

  private schedule(): void {
    if (this.pending) {
      return
    }
    this.pending = true
    setTimeout(() => {
      this.pending = false
      this.report()
    }, 0)
  }

  private report(): void {
    const live = this.wrappers.filter((wrapper) => wrapper.isConnected)
    const rects = live.flatMap(inputRectsOf)
    const payload = JSON.stringify(rects)
    if (payload === this.lastPayload) {
      return
    }
    this.lastPayload = payload
    this.runtime.bus.publish(`surface.${this.layer}.input`, { rects })
  }
}

// inputRectsOf takes the parts of a wrapper that should accept pointer input:
// the elements the view marked with data-input-region, or the wrapper itself
// when it marked none. A view painting a centred panel inside an edge-to-edge
// wrapper must not reserve the whole edge.
export function inputRectsOf(wrapper: HTMLElement): InputRect[] {
  const marked = wrapper.querySelectorAll<HTMLElement>('[data-input-region]')
  if (marked.length === 0) {
    return [rectOf(wrapper)]
  }
  return Array.from(marked, rectOf)
}

function rectOf(element: HTMLElement): InputRect {
  const box = element.getBoundingClientRect()
  const x = Math.floor(box.left)
  const y = Math.floor(box.top)
  return { x, y, w: Math.ceil(box.right) - x, h: Math.ceil(box.bottom) - y }
}
