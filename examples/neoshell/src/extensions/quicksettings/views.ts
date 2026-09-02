import type { Plugin } from '@neoworks/extension-system'
import { requireService } from '../../lib/services.js'
import type { ViewRegistry } from '../../host/plugins/views.js'
import Panel from './Panel.svelte'

// quicksettings views: the tray the clock opens, registered as
// quicksettings.panel.
//
// The webview build also injected the extension's compiled stylesheet here,
// once per webview document. There is one process and one GTK style provider
// now, so the panel's rules live in the shell's stylesheet with everything
// else and nothing has to be injected.

const plugin: Plugin.Object = {
  name: 'quicksettings-views',
  inject: ['ui', 'bus'],
  apply(context) {
    const ui = requireService<ViewRegistry>(context, 'ui')
    context.effect(() => ui.register('quicksettings.panel', Panel))
  },
}

export default plugin
