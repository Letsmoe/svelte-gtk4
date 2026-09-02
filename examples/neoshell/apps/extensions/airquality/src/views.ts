import { mount, unmount } from 'svelte'
import type { Component } from 'svelte'
import type { Plugin } from '@neoworks/extension-system'
import AirQuality from './AirQuality.svelte'
import { requireService } from './lib.js'
import type { BusLike } from './lib.js'
import './style.css'

// airquality views: the desktop air quality card, registered as
// airquality.card. The compiled stylesheet is injected once per webview
// document.

interface ViewInstance {
  dispose(): void
}

type ViewFactory = (element: HTMLElement, args: unknown) => ViewInstance

interface ViewRegistryLike {
  register(type: string, factory: ViewFactory): () => void
}

const plugin: Plugin.Object = {
  name: 'airquality-views',
  inject: ['ui', 'bus'],
  apply(context) {
    const ui = requireService<ViewRegistryLike>(context, 'ui')
    const bus = requireService<BusLike>(context, 'bus')
    context.effect(() => injectStylesheet())
    context.effect(() => ui.register('airquality.card', svelteFactory(AirQuality, { bus })))
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
  link.href = `/plugins/airquality/views.css${versionQueryOf(import.meta.url)}`
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
