import { mount, unmount } from 'svelte'
import type { Plugin } from '@neoworks/extension-system'
import Weather from './Weather.svelte'
import { requireService } from './lib.js'
import type { BusLike } from './lib.js'
import './style.css'

// weather views: the desktop weather card, registered as weather.card. The
// compiled stylesheet is injected once per webview document.
//
// The view tree node's id reaches the card because settings are per instance:
// two weather widgets on one desktop are two places, and the card addresses
// its own config entry and its own topic by that id.

interface ViewInstance {
  dispose(): void
}

type ViewFactory = (element: HTMLElement, args: unknown, id: string) => ViewInstance

interface ViewRegistryLike {
  register(type: string, factory: ViewFactory): () => void
}

const plugin: Plugin.Object = {
  name: 'weather-views',
  inject: ['ui', 'bus'],
  apply(context) {
    const ui = requireService<ViewRegistryLike>(context, 'ui')
    const bus = requireService<BusLike>(context, 'bus')
    context.effect(() => injectStylesheet())
    context.effect(() => ui.register('weather.card', cardFactory(bus)))
  },
}

export default plugin

function cardFactory(bus: BusLike): ViewFactory {
  return (element, _args, id) => {
    const instance = mount(Weather, { target: element, props: { bus, id } })
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
  link.href = `/plugins/weather/views.css${versionQueryOf(import.meta.url)}`
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
