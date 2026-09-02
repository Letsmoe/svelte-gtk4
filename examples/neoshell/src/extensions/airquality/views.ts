import type { Plugin } from '@neoworks/extension-system'
import { requireService } from '../../lib/services.js'
import type { ViewRegistry } from '../../host/plugins/views.js'
import AirQuality from './AirQuality.svelte'

// airquality views: the desktop card, registered as airquality.card — the type
// the widget declaration in the extension registry names, and what the gallery
// lists and the desktop places.

const plugin: Plugin.Object = {
  name: 'airquality-views',
  inject: ['ui', 'bus'],
  apply(context) {
    const ui = requireService<ViewRegistry>(context, 'ui')
    context.effect(() => ui.register('airquality.card', AirQuality))
  },
}

export default plugin
