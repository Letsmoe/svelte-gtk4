import type { Component, Snippet } from 'svelte'
import type { BusService } from '../../lib/bus.js'

// The "ui" service: view plugins register Svelte components under namespaced
// type names ("neoshell.topbar", "vpn.indicator") and the shell resolves the
// config view tree against it. Registration returns a disposer, so a view type
// vanishes with the plugin that contributed it.
//
// The webview build resolved a view type to a factory that mounted a component
// into a supplied element. There is no element here — the shell renders the
// component itself — so the registry holds the component, and a view that
// takes children takes them as a snippet like any other Svelte component.

export interface ViewProps {
  // Every view talks to the rest of the shell over the bus, so it arrives as a
  // prop rather than through a per-extension closure — the components are
  // rendered by the shell, not by the plugin that registered them.
  bus: BusService
  // The registry itself, for the two views that render other views: the
  // desktop, which places whatever widgets config lists, and the gallery, which
  // previews them.
  registry: ViewRegistry
  args: unknown
  // The view tree node's id. A view that persists anything per instance — a
  // widget's own settings, as against the extension's — needs it to address
  // its own config; views that hold no instance state ignore it.
  id: string
  children?: Snippet
}

export type ViewComponent = Component<ViewProps>

export class ViewRegistry {
  private readonly views = new Map<string, ViewComponent>()
  private readonly listeners = new Set<() => void>()

  register(type: string, component: ViewComponent): () => void {
    if (this.views.has(type)) {
      throw new Error(`ui: view type "${type}" is already registered`)
    }
    this.views.set(type, component)
    this.notifyChanged()
    return () => {
      this.views.delete(type)
      this.notifyChanged()
    }
  }

  resolve(type: string): ViewComponent | undefined {
    return this.views.get(type)
  }

  // onChange fires after every registration or removal — the shell re-renders
  // so views that arrive after the tree still appear.
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
