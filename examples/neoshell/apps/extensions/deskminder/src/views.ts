import { mount, unmount } from 'svelte'
import type { Component } from 'svelte'
import type { Plugin } from '@neoworks/extension-system'
import Pill from './Pill.svelte'
import Alert from './Alert.svelte'
import { requireService } from './lib.js'
import type { BusLike } from './lib.js'
import './style.css'

// deskminder views: the draggable desktop pill (deskminder.pill) and the
// fullscreen alert a reminder raises when it goes off (deskminder.alert). The
// two live on different layers — the pill behind application windows, the
// alert in front of them — so they are separate top-level view tree nodes
// rather than one view with two modes.

interface ViewInstance {
  dispose(): void
}

type ViewFactory = (element: HTMLElement, args: unknown, id: string) => ViewInstance

interface ViewRegistryLike {
  register(type: string, factory: ViewFactory): () => void
}

const plugin: Plugin.Object = {
  name: 'deskminder-views',
  inject: ['ui', 'bus'],
  apply(context) {
    const ui = requireService<ViewRegistryLike>(context, 'ui')
    const bus = requireService<BusLike>(context, 'bus')
    context.effect(() => injectStylesheet())
    context.effect(() => ui.register('deskminder.pill', svelteFactory(Pill, { bus })))
    context.effect(() => ui.register('deskminder.alert', svelteFactory(Alert, { bus })))
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
  link.href = `/plugins/deskminder/views.css${versionQueryOf(import.meta.url)}`
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
