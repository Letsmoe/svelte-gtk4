import type { ViewInstance, ViewRegistry } from './viewRegistry.js'

// ViewNode is one entry of the config view tree. type resolves against the
// registry; args are static configuration — live data comes from the view
// subscribing to the bus itself.
export interface ViewNode {
  id?: string
  type: string
  args?: unknown
  children?: ViewNode[]
}

// ChildSlot is how a view that lays out its own children (the desktop placing
// widgets on its grid) supplies the element each child renders into, already
// attached and positioned.
export type ChildSlot = (node: ViewNode) => HTMLElement

// renderTree renders nodes into container and returns a disposer that removes
// everything again, children before parents.
export function renderTree(
  container: HTMLElement,
  nodes: ViewNode[],
  registry: ViewRegistry,
  slotFor?: ChildSlot,
): () => void {
  const disposers = nodes.map((node) => renderNode(container, node, registry, slotFor))
  return () => {
    for (const dispose of disposers.reverse()) {
      dispose()
    }
  }
}

function renderNode(
  container: HTMLElement,
  node: ViewNode,
  registry: ViewRegistry,
  slotFor: ChildSlot | undefined,
): () => void {
  const factory = registry.resolve(node.type)
  if (factory === undefined) {
    console.error(`surface: unknown view type "${node.type}"`)
    return () => {}
  }
  const element = elementFor(container, node, slotFor)
  const instance = factory(element, node.args, idOf(node))
  const disposeChildren = renderChildren(element, node, instance, registry)
  return () => {
    disposeChildren()
    instance.dispose()
    element.remove()
  }
}

function idOf(node: ViewNode): string {
  if (typeof node.id === 'string') {
    return node.id
  }
  return ''
}

function elementFor(
  container: HTMLElement,
  node: ViewNode,
  slotFor: ChildSlot | undefined,
): HTMLElement {
  const element = attachElement(container, node, slotFor)
  element.dataset.view = node.type
  if (node.id !== undefined) {
    element.dataset.viewId = node.id
  }
  return element
}

function attachElement(
  container: HTMLElement,
  node: ViewNode,
  slotFor: ChildSlot | undefined,
): HTMLElement {
  if (slotFor !== undefined) {
    return slotFor(node)
  }
  const element = document.createElement('div')
  container.appendChild(element)
  return element
}

function renderChildren(
  element: HTMLElement,
  node: ViewNode,
  instance: ViewInstance,
  registry: ViewRegistry,
): () => void {
  if (node.children === undefined || node.children.length === 0) {
    return () => {}
  }
  let host = element
  if (instance.childrenHost !== undefined) {
    host = instance.childrenHost
  }
  return renderTree(host, node.children, registry, instance.childSlot)
}
