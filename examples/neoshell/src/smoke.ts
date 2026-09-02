// The library must be imported before anything that pulls in Svelte's client
// runtime: it installs the DOM globals that runtime reads at module scope.
import { start } from '@neoworks/svelte-gtk4'
import GLib from 'gi://GLib'
import System from 'system'
import { Bus } from './host/bus.js'
import { ViewRegistry } from './host/plugins/views.js'
import Smoke from './Smoke.svelte'
import SmokeCard from './SmokeCard.svelte'

// Builds every view in the shell once, in a plain window, and exits. `tsc`
// cannot see a GTK setter that does not exist — the typings run behind the
// installed GTK and several had to be reached through `as any` — so this is
// what catches one.
//
// It is deliberately not the shell: `main.ts` maps layer surfaces across the
// whole output and takes over the session it is run in. Nothing here touches
// the layer shell, and nothing here spawns nmcli or bluetoothctl: the state
// the views read is published onto a bus of its own.

const EXIT_AFTER_MS = 2000

const bus = new Bus()
const registry = new ViewRegistry()

// The gallery lists what the catalog holds and previews each entry with the
// registered view for its type, so a catalog with no provider behind it would
// build the empty branch and nothing else.
registry.register('smoke.card', SmokeCard)
bus.retain('widgets.catalog', {
  widgets: [
    {
      type: 'smoke.card',
      name: 'Smoke card',
      category: 'Smoke',
      description: 'a widget to preview',
      sizes: ['small'],
      defaultSize: 'small',
    },
  ],
})

bus.retain('hypr.monitors', [{ width: 1920, height: 1080 }])

// The two widget cards, with the series the medium and large sizes draw —
// their bar arithmetic only runs once there is something to scale.
for (const size of ['small', 'medium', 'large']) {
  bus.retain(`weather.current/smoke.weather.${size}`, {
    place: 'Smoke',
    temperature: 17,
    unit: '°C',
    code: 61,
    description: 'Light rain',
    isDay: true,
    high: 21,
    low: 11,
    hours: [
      { label: 'Now', temperature: 17, code: 61, isDay: true },
      { label: '15', temperature: 18, code: 3, isDay: true },
      { label: '16', temperature: 18, code: 0, isDay: true },
      { label: '17', temperature: 16, code: 95, isDay: false },
    ],
    days: [
      { label: 'Today', code: 61, high: 21, low: 11 },
      { label: 'Tue', code: 0, high: 24, low: 13 },
      // A flat day, which is what the day list's minimum bar width exists for.
      { label: 'Wed', code: 71, high: 15, low: 15 },
      { label: 'Thu', code: 95, high: 19, low: 9 },
    ],
  })
}

bus.retain('airquality.current', {
  index: 42,
  scale: 'european',
  category: 'Fair',
  max: 100,
  place: 'Smoke',
  updatedAt: Date.now(),
  hours: [
    { label: 'Now', index: 42 },
    { label: '15', index: 88 },
    // Zero and over-scale, the two ends the strip clamps.
    { label: '16', index: 0 },
    { label: '17', index: 140 },
  ],
  pollutants: [
    { label: 'PM2.5', value: 8, unit: 'µg/m³', share: 0.53 },
    { label: 'PM10', value: 61, unit: 'µg/m³', share: 1 },
    { label: 'NO₂', value: 1, unit: 'µg/m³', share: 0.04 },
  ],
})
bus.retain('system.volume', { volume: 40, muted: false })
bus.retain('system.brightness', { percent: 60, available: true })
bus.retain('system.battery', { percent: 80, status: 'Discharging' })
bus.retain('network.state', {
  available: true,
  enabled: true,
  connected: true,
  ssid: 'smoke',
  signal: 72,
  secured: true,
  device: 'wlan0',
  ipv4: '10.0.0.2/24',
  gateway: '10.0.0.1',
  dns: ['10.0.0.1'],
})
bus.retain('bluetooth.state', {
  available: true,
  powered: true,
  discovering: false,
  adapter: 'smoke',
})
bus.retain('bluetooth.devices', [
  { mac: '00:00:00:00:00:01', name: 'paired', connected: true, paired: true, icon: 'audio-headset' },
])

// Both surfaces render nothing but an input marker while closed, so the
// panel's tiles and the gallery's tiles only exist once they are opened. The
// commands are retained rather than published: the views subscribe from an
// effect, which runs after this module does, and only a retained topic
// replays for a late subscriber.
bus.retain('quicksettings:open', {})
bus.retain('widgets:gallery', { open: true })

GLib.timeout_add(GLib.PRIORITY_DEFAULT, EXIT_AFTER_MS, () => {
  print('neoshell: built every view — the tray, the gallery and both widget cards — without error')
  System.exit(0)
  return GLib.SOURCE_REMOVE
})

start(
  Smoke,
  { bus, registry },
  { stylesheet: GLib.build_filenamev([GLib.get_current_dir(), 'style.css']) },
)
