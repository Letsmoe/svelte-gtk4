import type { Plugin } from '@neoworks/extension-system'
import type { Bus } from '../bus.js'
import type { ViewRegistry } from './views.js'

export interface RuntimeConfig {
  bus: Bus
  registry: ViewRegistry
}

// The two services everything else injects. Both are constructed before the
// kernel starts, because the shell component is mounted by GTK rather than by
// a plugin and has to hold the same instances the extensions will get.
export const runtimePlugin: Plugin.Object<RuntimeConfig> = {
  name: 'runtime',
  apply(context, config) {
    context.provide('bus', config.bus)
    context.provide('ui', config.registry)
  },
}
