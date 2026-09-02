import { mount, unmount } from 'svelte'
import type { Component } from 'svelte'
import type { Context, Plugin } from '@neoworks/extension-system'
import Topbar from './Topbar.svelte'
import Notch from './Notch.svelte'
import Clock from './Clock.svelte'
import Battery from './Battery.svelte'
import Dock from './Dock.svelte'
import Desktop from './Desktop.svelte'
import Wallpaper from './Wallpaper.svelte'
import WidgetGallery from './WidgetGallery.svelte'
import { requireService } from './lib.js'
import type { BusLike } from './lib.js'
import { WidgetCanvas } from './widgetCanvas.js'
import type { ViewRegistryLike as CanvasRegistry } from './widgetCanvas.js'
import { DesktopStore } from './desktopStore.svelte.js'
import { recordOf } from './lib.js'
import './style.css'

// neoshell default views — the neoworks profile's surface set. Each view is a
// Svelte 5 component mounted by a registry factory; the compiled stylesheet
// (Tailwind/DaisyUI, neoworks theme) is injected once per webview document.

interface ViewInstance {
  dispose(): void
  childrenHost?: HTMLElement
}

type ViewFactory = (element: HTMLElement, args: unknown, id: string) => ViewInstance

interface ViewRegistryLike extends CanvasRegistry {
  register(type: string, factory: ViewFactory): () => void
}

const plugin: Plugin.Object = {
  name: 'neoshell-views',
  inject: ['ui', 'bus'],
  apply(context) {
    const ui = requireService<ViewRegistryLike>(context, 'ui')
    const bus = requireService<BusLike>(context, 'bus')
    context.effect(() => injectStylesheet())
    context.effect(() => ui.register('neoshell.topbar', topbarFactory(bus)))
    context.effect(() => ui.register('neoshell.notch', svelteFactory(Notch, { bus })))
    context.effect(() => ui.register('neoshell.clock', svelteFactory(Clock, { bus })))
    context.effect(() => ui.register('neoshell.battery', svelteFactory(Battery, { bus })))
    context.effect(() => ui.register('neoshell.dock', svelteFactory(Dock, { bus })))
    context.effect(() => ui.register('neoshell.wallpaper', svelteFactory(Wallpaper, { bus })))
    context.effect(() => ui.register('neoshell.desktop', desktopFactory(bus, context, ui)))
    context.effect(() =>
      ui.register('neoshell.widgetgallery', svelteFactory(WidgetGallery, { bus, ui })),
    )
  },
}

export default plugin

function svelteFactory<Props extends Record<string, unknown>>(
  component: Component<Props>,
  props: Props,
): ViewFactory {
  return (element) => {
    const instance = mount(component, { target: element, props })
    return {
      dispose() {
        void unmount(instance)
      },
    }
  }
}

// The desktop owns its widgets rather than receiving them as view tree
// children: config says which exist, so the canvas mounts each one as a child
// fiber and the node's args only seed a desktop that has never been arranged.
// The store is the placement both halves resolve against, and the canvas —
// plain DOM, outside Svelte's reactivity — reconciles on its notifications.
function desktopFactory(bus: BusLike, context: Context, ui: ViewRegistryLike): ViewFactory {
  return (element, args) => {
    const store = new DesktopStore(bus)
    store.setSeeds(recordOf(args).widgets)
    const canvasHost = document.createElement('div')
    canvasHost.className = 'fixed inset-0 pointer-events-none'
    const canvas = new WidgetCanvas(canvasHost, store, context, ui)
    const unsubscribeConfig = bus.subscribe('config', (message) => {
      store.applyConfig(message.data)
    })
    const unsubscribeAdd = bus.subscribe('widgets:add', (message) => {
      const request = recordOf(message.data)
      store.addWidget(String(request.type), String(request.size), droppedPoint(request))
    })
    const unsubscribeChange = store.onChange(() => canvas.reconcile())
    // A widget type registers when its extension's views bundle loads, which
    // can be after the desktop is up; reconciling on registry changes is what
    // mounts a widget whose type arrived late.
    const unsubscribeRegistry = ui.onChange(() => canvas.reconcile())
    const instance = mount(Desktop, { target: element, props: { bus, store } })
    element.appendChild(canvasHost)
    canvas.reconcile()
    return {
      dispose() {
        unsubscribeRegistry()
        unsubscribeChange()
        unsubscribeAdd()
        unsubscribeConfig()
        canvasHost.remove()
        void unmount(instance)
      },
    }
  }
}

// The gallery is a different surface, so a widget dragged onto the desktop
// arrives as coordinates rather than as a drop event. Both surfaces span the
// output, so the client coordinates need no translation.
function droppedPoint(request: Record<string, unknown>): { x: number; y: number } | undefined {
  const { x, y } = request
  if (typeof x !== 'number' || typeof y !== 'number') {
    return undefined
  }
  return { x, y }
}

// The topbar renders its children (clock, battery, …) through the surface
// renderer, which needs a plain element to mount into — created here and
// adopted by the component.
function topbarFactory(bus: BusLike): ViewFactory {
  return (element, args) => {
    const childrenHost = document.createElement('div')
    childrenHost.className = 'flex shrink-0 items-center gap-4'
    const centerGap = centerGapOf(args)
    const instance = mount(Topbar, { target: element, props: { bus, childrenHost, centerGap } })
    return {
      dispose() {
        void unmount(instance)
      },
      childrenHost,
    }
  }
}

// centerGap is the span the bar keeps clear for the notch, which floats over
// the bar's centre as a sibling top-level view.
function centerGapOf(args: unknown): number {
  if (typeof args !== 'object' || args === null) {
    return 0
  }
  const centerGap = (args as Record<string, unknown>).centerGap
  if (typeof centerGap === 'number') {
    return centerGap
  }
  return 0
}

// The module is remounted under a bumped ?g= on hot reload; the stylesheet has
// to carry the same version or the webview keeps serving its cached copy.
function versionQueryOf(moduleUrl: string): string {
  const queryStart = moduleUrl.indexOf('?')
  if (queryStart < 0) {
    return ''
  }
  return moduleUrl.slice(queryStart)
}

function injectStylesheet(): () => void {
  // The dev server injects the stylesheet through the module graph and keeps
  // it hot; only the built bundle has it as a sibling file to link.
  if (servedFromDevServer()) {
    return () => {}
  }
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `/plugins/neoshell/views.css${versionQueryOf(import.meta.url)}`
  document.head.appendChild(link)
  return () => {
    link.remove()
  }
}

// The built bundle is served by the host, the same origin as the page; the
// dev server is a port of its own.
function servedFromDevServer(): boolean {
  return new URL(import.meta.url).origin !== window.location.origin
}
