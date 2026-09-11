import type { Plugin } from '@neoworks/extension-system'
import { requireService } from '../../lib/services.js'
import type { ViewRegistry } from '../../host/plugins/views.js'
import LockScreen from './LockScreen.svelte'

const plugin: Plugin.Object = {
  name: 'lock-views',
  inject: ['ui'],
  apply(context) {
    const ui = requireService<ViewRegistry>(context, 'ui')
    context.effect(() => ui.register('lock.screen', LockScreen))
  },
}

export default plugin
