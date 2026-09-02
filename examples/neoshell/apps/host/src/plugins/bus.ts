import type { Plugin } from '@neoworks/extension-system'
import { Bus } from '../bus.js'

export const busPlugin: Plugin.Object = {
  name: 'bus',
  apply(context) {
    context.provide('bus', new Bus())
  },
}
