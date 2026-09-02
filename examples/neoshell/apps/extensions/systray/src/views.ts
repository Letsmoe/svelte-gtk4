import { mount, unmount } from 'svelte'
import type { Plugin } from '@neoworks/extension-system'
import Systray from './Systray.svelte'
import Menu from './Menu.svelte'
import { requireService } from './lib.js'
import type { BusLike } from './lib.js'
import './style.css'

// systray views: the tray strip, registered as systray.indicator, and the
// popup its items open, registered as systray.menu. The strip is an ordinary
// top bar child — the bar reserves no space for it, so a session with no tray
// items draws nothing at all. The menu is a separate top-level view because a
// dbusmenu does not fit inside a thirty-pixel bar.

interface ViewInstance {
  dispose(): void
}

type ViewFactory = (element: HTMLElement, args: unknown, id: string) => ViewInstance

interface ViewRegistryLike {
  register(type: string, factory: ViewFactory): () => void
}

const plugin: Plugin.Object = {
  name: 'systray-views',
  inject: ['ui', 'bus'],
  apply(context) {
    const ui = requireService<ViewRegistryLike>(context, 'ui')
    const bus = requireService<BusLike>(context, 'bus')
    context.effect(() => injectStylesheet())
    context.effect(() => ui.register('systray.indicator', indicatorFactory(bus)))
    context.effect(() => ui.register('systray.menu', menuFactory(bus)))
  },
}

export default plugin

function indicatorFactory(bus: BusLike): ViewFactory {
  return (element) => {
    const instance = mount(Systray, { target: element, props: { bus } })
    return {
      dispose() {
        void unmount(instance)
      },
    }
  }
}

function menuFactory(bus: BusLike): ViewFactory {
  return (element) => {
    const instance = mount(Menu, { target: element, props: { bus } })
    return {
      dispose() {
        void unmount(instance)
      },
    }
  }
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
  link.href = `/plugins/systray/views.css${versionQueryOf(import.meta.url)}`
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
