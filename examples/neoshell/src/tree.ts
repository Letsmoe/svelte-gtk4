import type { ViewComponent, ViewRegistry } from './host/plugins/views.js'

// The shape of the config view tree, and the arg readers the shell needs to
// turn a top-level node into a layer-shell window.

export interface TreeNode {
  id?: string
  type: string
  args?: unknown
  children?: TreeNode[]
}

const LAYERS = new Set(['background', 'bottom', 'top', 'overlay'])
const KEYBOARD_MODES = new Set(['none', 'ondemand', 'exclusive'])
const EDGES = ['top', 'bottom', 'left', 'right']

export function nodesOf(data: unknown): TreeNode[] {
  if (!Array.isArray(data)) {
    return []
  }
  return data.filter(isTreeNode)
}

export function childrenOf(node: TreeNode): TreeNode[] {
  if (node.children === undefined) {
    return []
  }
  return node.children
}

// A node's key has to survive a config edit that reorders the tree, so it is
// the id when there is one and the position-qualified type when there is not.
export function keyOf(node: TreeNode, index: number): string {
  if (node.id !== undefined && node.id !== '') {
    return node.id
  }
  return `${index}:${node.type}`
}

export function idOf(node: TreeNode): string {
  if (node.id === undefined) {
    return ''
  }
  return node.id
}

// The registry is not reactive on its own; the shell bumps a generation
// counter from onChange and passes it in, so resolving a type again is what a
// late registration triggers.
export function resolve(
  registry: ViewRegistry,
  type: string,
  _generation: number,
): ViewComponent | undefined {
  return registry.resolve(type)
}

export function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  return value as Record<string, unknown>
}

export function namespaceOf(node: TreeNode): string {
  const id = idOf(node)
  if (id === '') {
    return `neoshell.${node.type}`
  }
  return `neoshell.${id}`
}

export function layerOf(args: Record<string, unknown>): string {
  const layer = args.layer
  if (typeof layer === 'string' && LAYERS.has(layer)) {
    return layer
  }
  return 'top'
}

export function keyboardOf(args: Record<string, unknown>): string {
  const keyboard = args.keyboard
  if (typeof keyboard === 'string' && KEYBOARD_MODES.has(keyboard)) {
    return keyboard
  }
  return 'none'
}

// gtk4-layer-shell takes the anchored edges as a space-separated list. A node
// that names none is anchored to every edge, which is what a full-screen
// desktop layer wants.
export function anchorOf(args: Record<string, unknown>): string {
  if (!Array.isArray(args.anchors)) {
    return EDGES.join(' ')
  }
  const anchors = args.anchors.filter((edge) => EDGES.includes(edge as string))
  return anchors.join(' ')
}

// The compositor reserves this much space along the anchored edge. -1 is the
// default rather than 0, because it means "reserve nothing and ignore what
// everyone else reserved": a notch floating over the bar has to overlap the
// strip the bar reserved, and 0 would have the compositor push it clear.
export function exclusiveZoneOf(args: Record<string, unknown>): number {
  const size = args.exclusiveSize
  if (typeof size !== 'number') {
    return -1
  }
  return size
}

export function marginOf(args: Record<string, unknown>): number {
  const margin = args.margin
  if (typeof margin !== 'number') {
    return 0
  }
  return margin
}

// -1 leaves the axis to the anchors and the content; anything else is the
// window's default size. It has to be the default size and not a size request:
// gtk4-layer-shell asks the window for its size, and a layer surface whose
// content is smaller than GTK's 200x200 fallback gets the fallback however
// small the request underneath it is.
export function sizeOf(args: Record<string, unknown>, key: 'width' | 'height'): number {
  const size = args[key]
  if (typeof size !== 'number') {
    return -1
  }
  return size
}

function isTreeNode(value: unknown): value is TreeNode {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  return typeof (value as TreeNode).type === 'string'
}
