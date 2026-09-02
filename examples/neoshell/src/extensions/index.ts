import type { Plugin } from '@neoworks/extension-system'
import hyprBackend from './hypr/backend.js'
import systemBackend from './system/backend.js'
import appsBackend from './apps/backend.js'
import mediaBackend from './media/backend.js'
import filesBackend from './files/backend.js'
import networkBackend from './network/backend.js'
import bluetoothBackend from './bluetooth/backend.js'
import weatherBackend from './weather/backend.js'
import airQualityBackend from './airquality/backend.js'
import neoshellViews from './neoshell/views.js'
import quicksettingsViews from './quicksettings/views.js'
import weatherViews from './weather/views.js'
import airQualityViews from './airquality/views.js'

// The extension registry. In the bun host an extension was a directory the
// loader found by scanning for manifest.json and imported at runtime; one GJS
// process running one bundle has no runtime module loading to do, so the scan
// becomes this table. Everything else about an extension is unchanged: a
// manifest declaring what it needs, a backend half, a view half, either or
// both.

export interface WidgetDeclaration {
  type: string
  name: string
  category: string
  description: string
  sizes: string[]
  defaultSize: string
}

export interface ExtensionManifest {
  id: string
  inject?: string[]
  provides?: string[]
  widgets?: WidgetDeclaration[]
}

export interface ExtensionModule {
  manifest: ExtensionManifest
  backend?: Plugin.Object
  views?: Plugin.Object
}

export const EXTENSIONS: Record<string, ExtensionModule> = {
  hypr: {
    manifest: { id: 'hypr', inject: ['bus'], provides: ['hypr'] },
    backend: hyprBackend as Plugin.Object,
  },
  system: {
    manifest: { id: 'system', inject: ['bus'] },
    backend: systemBackend as Plugin.Object,
  },
  apps: {
    manifest: { id: 'apps', inject: ['bus'] },
    backend: appsBackend as Plugin.Object,
  },
  media: {
    manifest: { id: 'media', inject: ['bus'] },
    backend: mediaBackend as Plugin.Object,
  },
  files: {
    manifest: { id: 'files', inject: ['bus'] },
    backend: filesBackend as Plugin.Object,
  },
  network: {
    manifest: { id: 'network', inject: ['bus'] },
    backend: networkBackend as Plugin.Object,
  },
  bluetooth: {
    manifest: { id: 'bluetooth', inject: ['bus'] },
    backend: bluetoothBackend as Plugin.Object,
  },
  neoshell: {
    manifest: { id: 'neoshell', inject: ['bus', 'ui'] },
    views: neoshellViews,
  },
  quicksettings: {
    manifest: { id: 'quicksettings', inject: ['bus', 'ui'] },
    views: quicksettingsViews,
  },
  // The two widget providers. Their `widgets` declarations are what the
  // gallery lists — read from the manifest rather than from the mount list, so
  // a widget appears in the gallery because its extension is installed, not
  // because it is running.
  weather: {
    manifest: {
      id: 'weather',
      inject: ['bus', 'ui'],
      widgets: [
        {
          type: 'weather.card',
          name: 'Weather',
          category: 'Weather',
          description: 'Current conditions, the next hours, and the coming days.',
          sizes: ['small', 'medium', 'large'],
          defaultSize: 'small',
        },
      ],
    },
    backend: weatherBackend as Plugin.Object,
    views: weatherViews,
  },
  airquality: {
    manifest: {
      id: 'airquality',
      inject: ['bus', 'ui'],
      widgets: [
        {
          type: 'airquality.card',
          name: 'Air Quality',
          category: 'Weather',
          description: 'The air quality index, the next hours, and the pollutants behind it.',
          sizes: ['small', 'medium', 'large'],
          defaultSize: 'small',
        },
      ],
    },
    backend: airQualityBackend as Plugin.Object,
    views: airQualityViews,
  },
}
