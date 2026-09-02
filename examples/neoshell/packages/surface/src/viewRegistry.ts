import type { ChildSlot } from './renderer.js'

// ViewRegistry is the surface's "ui" service: view plugins register factories
// under namespaced type names ("neoshell.topbar", "vpn.indicator"), and the
// renderer resolves view-tree nodes against it. Registration returns a
// disposer, so a view type vanishes with the plugin that contributed it.

export interface ViewInstance {
  dispose(): void
  // Views with children render them into this element; absent means children
  // render directly into the view's own element.
  childrenHost?: HTMLElement
  // Views that place their children themselves supply the element each child
  // renders into; absent means children are appended in flow order.
  childSlot?: ChildSlot
}

// id is the view tree node's id. A view that persists anything per instance —
// a widget's own settings, as against the extension's — needs it to address
// its own config; views that hold no instance state ignore it.
export type ViewFactory = (element: HTMLElement, args: unknown, id: string) => ViewInstance

export class ViewRegistry {
  private readonly views = new Map<string, ViewFactory>()
  private readonly listeners = new Set<() => void>()

  register(type: string, factory: ViewFactory): () => void {
    if (this.views.has(type)) {
      throw new Error(`ui: view type "${type}" is already registered`)
    }
    this.views.set(type, factory)
    this.notifyChanged()
    return () => {
      this.views.delete(type)
      this.notifyChanged()
    }
  }

  resolve(type: string): ViewFactory | undefined {
    return this.views.get(type)
  }

  // onChange fires after every registration or removal — the renderer
  // re-renders so views that arrive after the tree still appear.
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notifyChanged(): void {
    for (const listener of [...this.listeners]) {
      listener()
    }
  }
}
