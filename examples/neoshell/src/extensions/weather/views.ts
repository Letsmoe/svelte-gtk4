import type { Plugin } from '@neoworks/extension-system'
import { requireService } from '../../lib/services.js'
import type { ViewRegistry } from '../../host/plugins/views.js'
import Weather from './Weather.svelte'

// weather views: the desktop card, registered as weather.card — the type the
// widget declaration in the extension registry names, and what the gallery
// lists and the desktop places.

const plugin: Plugin.Object = {
  name: 'weather-views',
  inject: ['ui', 'bus'],
  apply(context) {
    const ui = requireService<ViewRegistry>(context, 'ui')
    context.effect(() => ui.register('weather.card', Weather))
  },
}

export default plugin
