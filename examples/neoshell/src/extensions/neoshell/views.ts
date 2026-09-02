import type { Plugin } from '@neoworks/extension-system'
import { requireService } from '../../lib/services.js'
import type { ViewRegistry } from '../../host/plugins/views.js'
import Topbar from './Topbar.svelte'
import Notch from './Notch.svelte'
import Clock from './Clock.svelte'
import Battery from './Battery.svelte'
import Dock from './Dock.svelte'
import Wallpaper from './Wallpaper.svelte'
import Desktop from './Desktop.svelte'
import WidgetGallery from './WidgetGallery.svelte'

// neoshell default views — the neoworks profile's surface set. Registration is
// an effect, so a view type leaves the registry with the extension and the
// shell drops the window that was showing it.

const plugin: Plugin.Object = {
  name: 'neoshell-views',
  inject: ['ui'],
  apply(context) {
    const ui = requireService<ViewRegistry>(context, 'ui')
    context.effect(() => ui.register('neoshell.topbar', Topbar))
    context.effect(() => ui.register('neoshell.notch', Notch))
    context.effect(() => ui.register('neoshell.clock', Clock))
    context.effect(() => ui.register('neoshell.battery', Battery))
    context.effect(() => ui.register('neoshell.dock', Dock))
    context.effect(() => ui.register('neoshell.wallpaper', Wallpaper))
    context.effect(() => ui.register('neoshell.desktop', Desktop))
    context.effect(() => ui.register('neoshell.widgetgallery', WidgetGallery))
  },
}

export default plugin
