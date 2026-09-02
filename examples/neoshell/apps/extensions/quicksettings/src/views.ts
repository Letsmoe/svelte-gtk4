import { mount, unmount } from 'svelte'
import type { Plugin } from '@neoworks/extension-system'
import Panel from './Panel.svelte'
import { requireService } from './lib.js'
import type { BusLike } from './lib.js'
import './style.css'

// quicksettings views: the tray the clock opens, registered as
// quicksettings.panel. The compiled stylesheet is injected once per webview
// document.

interface ViewInstance {
  dispose(): void
}

type ViewFactory = (element: HTMLElement, args: unknown) => ViewInstance

interface ViewRegistryLike {
  register(type: string, factory: ViewFactory): () => void
}

const plugin: Plugin.Object = {
  name: 'quicksettings-views',
  inject: ['ui', 'bus'],
  apply(context) {
    const ui = requireService<ViewRegistryLike>(context, 'ui')
    const bus = requireService<BusLike>(context, 'bus')
    context.effect(() => injectStylesheet())
    context.effect(() => ui.register('quicksettings.panel', panelFactory(bus)))
  },
}

export default plugin

function panelFactory(bus: BusLike): ViewFactory {
  return (element, args) => {
    const instance = mount(Panel, { target: element, props: { bus, top: topOf(args) } })
    return {
      dispose() {
        void unmount(instance)
      },
    }
  }
}

// top is where the tray hangs from — the bar's height plus its gap, passed in
// so the panel does not hard-code a bar size it does not own.
function topOf(args: unknown): number {
  if (typeof args !== 'object' || args === null) {
    return 36
  }
  const top = (args as Record<string, unknown>).top
  if (typeof top === 'number') {
    return top
  }
  return 36
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
  link.href = `/plugins/quicksettings/views.css${versionQueryOf(import.meta.url)}`
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
