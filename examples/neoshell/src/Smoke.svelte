<script lang="ts">
  import type { BusService } from './lib/bus'
  import type { ViewRegistry } from './host/plugins/views'
  import Panel from './extensions/quicksettings/Panel.svelte'
  import WifiPage from './extensions/quicksettings/WifiPage.svelte'
  import BluetoothPage from './extensions/quicksettings/BluetoothPage.svelte'
  import WidgetGallery from './extensions/neoshell/WidgetGallery.svelte'
  import Weather from './extensions/weather/Weather.svelte'
  import AirQuality from './extensions/airquality/AirQuality.svelte'
  import { MAX_UNIT_PX, sizePx, spanOf } from './extensions/neoshell/freeform'
  import type { BluetoothState, NetworkState } from './extensions/quicksettings/types'

  // The smoke harness's markup: every view added for the quick settings tray
  // and the widget gallery, built once in a plain window.
  //
  // The tray's detail pages are reached by clicking, and their state is the
  // panel's own — so they are mounted again here, directly, to get their
  // widgets built. Everything a page can show that a list does not (the
  // password prompt, the connection details) is ordinary labels and an entry.

  let { bus, registry }: { bus: BusService; registry: ViewRegistry } = $props()

  const networkState: NetworkState = {
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
  }

  const bluetoothState: BluetoothState = {
    available: true,
    powered: true,
    discovering: false,
    adapter: 'smoke',
  }

  const networks = [
    { ssid: 'smoke', signal: 72, secured: true, active: true, saved: true },
    { ssid: 'other', signal: 20, secured: false, active: false, saved: false },
  ]

  // A widget card lays itself out from the size it is given, so every size is
  // built rather than only whichever one a default would have picked.
  const CARD_SIZES = ['small', 'medium', 'large']

  function boxFor(size: string) {
    const box = sizePx(MAX_UNIT_PX, spanOf(size))
    return { size, width: box.width, height: box.height }
  }

  const devices = [
    {
      mac: '00:00:00:00:00:01',
      name: 'paired device',
      connected: true,
      paired: true,
      trusted: true,
      icon: 'audio-headset',
      battery: 80,
    },
    {
      mac: '00:00:00:00:00:02',
      name: 'nearby device',
      connected: false,
      paired: false,
      trusted: false,
      icon: '',
      battery: -1,
    },
  ]
</script>

<gtkwindow title="neoshell smoke" default-width={1400} default-height={760}>
  <gtkscrolledwindow>
    <gtkbox orientation="horizontal" spacing={16} margin={16} valign="start">
      <Panel {bus} {registry} args={{}} id="smoke.panel" />
      <gtkbox class="panel" orientation="vertical" width={328} valign="start">
        <WifiPage {bus} {networkState} {networks} onBack={() => {}} />
      </gtkbox>
      <gtkbox class="panel" orientation="vertical" width={328} valign="start">
        <BluetoothPage {bus} {bluetoothState} {devices} onBack={() => {}} />
      </gtkbox>
      <WidgetGallery {bus} {registry} args={{}} id="smoke.gallery" />

      <!-- The password prompt, the connection details and the power menu are
           reached by clicking, and their state belongs to a component this
           harness cannot drive. The widgets they build that nothing else here
           does are built directly instead, with the attributes they carry. -->
      <gtkbox class="panel" orientation="vertical" spacing={10} width={328} valign="start">
        <gtkpasswordentry
          class="qs-entry"
          placeholder="Password"
          peek
          text=""
        ></gtkpasswordentry>
        <gtkseparator class="qs-separator" orientation="horizontal"></gtkseparator>
        <gtkbox class="qs-power-menu" orientation="vertical" spacing={2}>
          <gtkbutton class="qs-power-item" frame={false}>Lock</gtkbutton>
          <gtkbutton class="qs-power-item danger" frame={false}>Power off</gtkbutton>
        </gtkbox>
        <gtkbox class="qs-details" orientation="vertical" spacing={6}>
          <gtklabel class="qs-detail-value" tabular halign="end" ellipsize="end">10.0.0.2</gtklabel>
        </gtkbox>
        <gtkbox orientation="horizontal" spacing={8} halign="end">
          <gtkbutton class="qs-button" frame={false}>Forget</gtkbutton>
          <gtkbutton class="qs-button primary" frame={false}>Connect</gtkbutton>
        </gtkbox>
      </gtkbox>

      {#each CARD_SIZES as size (size)}
        {@const box = boxFor(size)}
        <gtkbox orientation="vertical" spacing={12} valign="start">
          <gtkbox width={box.width} height={box.height}>
            <Weather {bus} {registry} args={box} id={`smoke.weather.${size}`} />
          </gtkbox>
          <gtkbox width={box.width} height={box.height}>
            <AirQuality {bus} {registry} args={box} id={`smoke.airquality.${size}`} />
          </gtkbox>
        </gtkbox>
      {/each}
    </gtkbox>
  </gtkscrolledwindow>
</gtkwindow>
