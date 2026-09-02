<script lang="ts">
  import { errorOf, subscribeTo } from '../../lib/bus'
  import type { ViewProps } from '../../host/plugins/views'
  import { arrayOf, numberOf, recordOf, stringListOf, stringOf } from '../../lib/record'
  import Tile from './Tile.svelte'
  import SliderRow from './SliderRow.svelte'
  import WifiPage from './WifiPage.svelte'
  import BluetoothPage from './BluetoothPage.svelte'
  import { deviceIcon, iconName, signalIcon, signalLabel } from './icons'
  import type { BluetoothDevice, BluetoothState, NetworkState, WifiNetwork } from './types'
  //
  // The quick settings panel: a ChromeOS-style tray hanging under the bar,
  // opened by the clock.
  //
  //   quicksettings:toggle / :open / :close   drive visibility
  //
  // The webview build rendered this into a wrapper spanning the whole output so
  // a scrim could catch a click anywhere and dismiss the tray. The tray is its
  // own layer-shell window here, anchored to the top-right corner and only as
  // large as the panel — there is no surface left over to put a scrim on, so
  // the clock's toggle, the pages' own buttons and the actions that close on
  // completion are what dismiss it. A closed tray draws a zero-size marker
  // instead of nothing: an empty input region is what keeps the corner
  // click-through, and a surface with no marked widget at all claims the lot.

  const COMMAND_TIMEOUT_MS = 5000
  const PANEL_WIDTH = 328
  const SCREENSHOT_COMMAND = 'grim -g "$(slurp)"'

  type Page = 'main' | 'wifi' | 'bluetooth'

  let { bus }: ViewProps = $props()

  let open = $state(false)
  let page = $state<Page>('main')
  let powerMenuOpen = $state(false)

  let network = $state<NetworkState>(emptyNetworkState())
  let networks = $state<WifiNetwork[]>([])
  let bluetooth = $state<BluetoothState>(emptyBluetoothState())
  let devices = $state<BluetoothDevice[]>([])
  let volume = $state(0)
  let muted = $state(false)
  let brightness = $state(0)
  let brightnessAvailable = $state(false)
  let batteryPercent = $state(-1)
  let batteryStatus = $state('')
  let doNotDisturb = $state(false)
  let keyboardLayout = $state('')

  const connectedDevice = $derived(devices.find((device) => device.connected))

  $effect(() => subscribeTo(bus, 'quicksettings:toggle', () => setOpen(!open)))
  $effect(() => subscribeTo(bus, 'quicksettings:open', () => setOpen(true)))
  $effect(() => subscribeTo(bus, 'quicksettings:close', () => setOpen(false)))

  $effect(() =>
    subscribeTo(bus, 'network.state', (message) => {
      network = networkStateOf(message.data)
    }),
  )

  $effect(() =>
    subscribeTo(bus, 'network.networks', (message) => {
      networks = networksOf(message.data)
    }),
  )

  $effect(() =>
    subscribeTo(bus, 'bluetooth.state', (message) => {
      bluetooth = bluetoothStateOf(message.data)
    }),
  )

  $effect(() =>
    subscribeTo(bus, 'bluetooth.devices', (message) => {
      devices = devicesOf(message.data)
    }),
  )

  $effect(() =>
    subscribeTo(bus, 'system.volume', (message) => {
      applyVolume(message.data)
    }),
  )

  $effect(() =>
    subscribeTo(bus, 'system.brightness', (message) => {
      applyBrightness(message.data)
    }),
  )

  $effect(() =>
    subscribeTo(bus, 'system.battery', (message) => {
      applyBattery(message.data)
    }),
  )

  $effect(() =>
    subscribeTo(bus, 'config', (message) => {
      doNotDisturb = recordOf(recordOf(message.data).notifications).doNotDisturb === true
    }),
  )

  $effect(() =>
    subscribeTo(bus, 'hypr.event', (message) => {
      applyKeyboardLayout(message.data)
    }),
  )

  // `open` is read inside the toggle handler, which runs long after the effect
  // that subscribed it — reading it there would not track anyway, so the
  // toggle reads the same state every other handler does.
  function setOpen(next: boolean): void {
    open = next
    if (next) {
      return
    }
    page = 'main'
    powerMenuOpen = false
  }

  function close(): void {
    setOpen(false)
  }

  function applyVolume(data: unknown): void {
    const record = recordOf(data)
    volume = numberOf(record.volume, volume)
    muted = record.muted === true
  }

  function applyBrightness(data: unknown): void {
    const record = recordOf(data)
    brightness = numberOf(record.percent, brightness)
    brightnessAvailable = record.available === true
  }

  function applyBattery(data: unknown): void {
    const record = recordOf(data)
    batteryPercent = numberOf(record.percent, -1)
    batteryStatus = stringOf(record.status)
  }

  // Hyprland announces layout switches as "activelayout>>DEVICE,LAYOUT"; the
  // layout is everything after the last comma, since device names contain them.
  function applyKeyboardLayout(data: unknown): void {
    const record = recordOf(data)
    if (record.event !== 'activelayout' || typeof record.data !== 'string') {
      return
    }
    const separator = record.data.lastIndexOf(',')
    if (separator < 0) {
      return
    }
    keyboardLayout = record.data.slice(separator + 1)
  }

  function setVolume(percent: number): void {
    volume = percent
    void bus.call('system:setVolume', { volume: percent }, COMMAND_TIMEOUT_MS)
  }

  function toggleMute(): void {
    muted = !muted
    void bus.call('system:setMuted', { muted }, COMMAND_TIMEOUT_MS)
  }

  function setBrightness(percent: number): void {
    brightness = percent
    void bus.call('system:setBrightness', { percent }, COMMAND_TIMEOUT_MS)
  }

  function toggleDoNotDisturb(): void {
    doNotDisturb = !doNotDisturb
    bus.publish('config:set', { key: 'notifications.doNotDisturb', value: doNotDisturb })
  }

  function captureScreen(): void {
    close()
    void bus.call(
      'hypr:dispatch',
      { dispatcher: 'exec', arg: SCREENSHOT_COMMAND },
      COMMAND_TIMEOUT_MS,
    )
  }

  async function runPowerAction(action: string): Promise<void> {
    close()
    const reply = await bus.call('system:power', { action }, COMMAND_TIMEOUT_MS)
    const error = errorOf(reply)
    if (error !== '') {
      console.error(`quicksettings: ${action} failed:`, error)
    }
  }

  function toggleWifi(): void {
    void bus.call('network:enable', { enabled: !network.enabled }, 15000)
  }

  function toggleBluetooth(): void {
    void bus.call('bluetooth:power', { powered: !bluetooth.powered }, 15000)
  }

  function wifiTitle(): string {
    if (network.connected) {
      return network.ssid
    }
    return 'Wi-Fi'
  }

  function wifiSubtitle(): string {
    if (!network.available) {
      return 'No adapter'
    }
    if (!network.enabled) {
      return 'Off'
    }
    if (!network.connected) {
      return 'Not connected'
    }
    return signalLabel(network.signal)
  }

  function bluetoothSubtitle(): string {
    if (!bluetooth.available) {
      return 'No adapter'
    }
    if (!bluetooth.powered) {
      return 'Off'
    }
    if (connectedDevice !== undefined) {
      return connectedDevice.name
    }
    return 'On'
  }

  function bluetoothIcon(): string {
    if (connectedDevice === undefined) {
      return 'bluetooth'
    }
    return deviceIcon(connectedDevice.icon)
  }

  function keyboardSubtitle(): string {
    if (keyboardLayout === '') {
      return 'Default'
    }
    return keyboardLayout
  }

  function volumeIcon(): string {
    if (muted) {
      return 'volumeMuted'
    }
    return 'volume'
  }

  function batteryLabel(): string {
    if (batteryStatus === '') {
      return `${batteryPercent}%`
    }
    return `${batteryPercent}% · ${batteryStatus}`
  }

  function networkStateOf(data: unknown): NetworkState {
    const record = recordOf(data)
    return {
      available: record.available === true,
      enabled: record.enabled === true,
      connected: record.connected === true,
      ssid: stringOf(record.ssid),
      signal: numberOf(record.signal, 0),
      secured: record.secured === true,
      device: stringOf(record.device),
      ipv4: stringOf(record.ipv4),
      gateway: stringOf(record.gateway),
      dns: stringListOf(record.dns),
    }
  }

  function networksOf(data: unknown): WifiNetwork[] {
    return arrayOf(data).map((record) => ({
      ssid: stringOf(record.ssid),
      signal: numberOf(record.signal, 0),
      secured: record.secured === true,
      active: record.active === true,
      saved: record.saved === true,
    }))
  }

  function bluetoothStateOf(data: unknown): BluetoothState {
    const record = recordOf(data)
    return {
      available: record.available === true,
      powered: record.powered === true,
      discovering: record.discovering === true,
      adapter: stringOf(record.adapter),
    }
  }

  function devicesOf(data: unknown): BluetoothDevice[] {
    return arrayOf(data).map((record) => ({
      mac: stringOf(record.mac),
      name: stringOf(record.name),
      connected: record.connected === true,
      paired: record.paired === true,
      trusted: record.trusted === true,
      icon: stringOf(record.icon),
      battery: numberOf(record.battery, -1),
    }))
  }

  function emptyNetworkState(): NetworkState {
    return {
      available: false,
      enabled: false,
      connected: false,
      ssid: '',
      signal: 0,
      secured: false,
      device: '',
      ipv4: '',
      gateway: '',
      dns: [],
    }
  }

  function emptyBluetoothState(): BluetoothState {
    return { available: false, powered: false, discovering: false, adapter: '' }
  }
</script>

{#if open}
  <gtkbox class="panel" orientation="vertical" spacing={10} width={PANEL_WIDTH} input>
    {#if page === 'wifi'}
      <WifiPage {bus} networkState={network} {networks} onBack={() => (page = 'main')} />
    {:else if page === 'bluetooth'}
      <BluetoothPage
        {bus}
        bluetoothState={bluetooth}
        {devices}
        onBack={() => (page = 'main')}
      />
    {:else}
      <!-- The four-column tile grid was CSS grid with two-column spans. GTK has
           no span outside gtkgrid, whose cells have to be template literals, so
           the same layout is homogeneous rows: each half is one wide tile, or
           two compact ones sharing it. -->
      <gtkbox orientation="vertical" spacing={8}>
        <gtkbox orientation="horizontal" spacing={8} homogeneous>
          <Tile
            icon={signalIcon(network.signal, network.connected)}
            title={wifiTitle()}
            subtitle={wifiSubtitle()}
            active={network.enabled}
            disabled={!network.available}
            onActivate={toggleWifi}
            onOpen={() => (page = 'wifi')}
          />
          <gtkbox orientation="horizontal" spacing={8} homogeneous>
            <Tile compact icon="camera" title="Screen capture" onActivate={captureScreen} />
            <Tile
              compact
              icon="moon"
              title="Do not disturb"
              active={doNotDisturb}
              onActivate={toggleDoNotDisturb}
            />
          </gtkbox>
        </gtkbox>

        <gtkbox orientation="horizontal" spacing={8} homogeneous>
          <Tile
            icon={bluetoothIcon()}
            title="Bluetooth"
            subtitle={bluetoothSubtitle()}
            active={bluetooth.powered}
            disabled={!bluetooth.available}
            onActivate={toggleBluetooth}
            onOpen={() => (page = 'bluetooth')}
          />
          <Tile icon="cast" title="Cast screen" subtitle="Unavailable" disabled />
        </gtkbox>

        <gtkbox orientation="horizontal" spacing={8} homogeneous>
          <Tile icon="share" title="Nearby share" subtitle="Unavailable" disabled />
          <Tile icon="keyboard" title="Keyboard" subtitle={keyboardSubtitle()} disabled />
        </gtkbox>
      </gtkbox>

      <gtkbox orientation="vertical" spacing={8}>
        <SliderRow
          icon={volumeIcon()}
          label="Volume"
          value={volume}
          onInput={setVolume}
          onIconClick={toggleMute}
        />
        <SliderRow
          icon="sun"
          label="Brightness"
          value={brightness}
          disabled={!brightnessAvailable}
          onInput={setBrightness}
        />
      </gtkbox>

      <gtkseparator class="qs-separator" orientation="horizontal"></gtkseparator>

      <gtkbox class="qs-footer" orientation="horizontal" spacing={4}>
        <gtkbutton
          class="qs-power-button"
          frame={false}
          tooltip="Power options"
          onclicked={() => (powerMenuOpen = !powerMenuOpen)}
        >
          <gtkbox orientation="horizontal" spacing={2}>
            <gtkicon icon={iconName('power')} size={16}></gtkicon>
            <gtkicon icon={iconName('chevronDown')} size={12}></gtkicon>
          </gtkbox>
        </gtkbutton>
        <gtkbox hexpand></gtkbox>
        {#if batteryPercent >= 0}
          <gtklabel class="qs-battery" tabular valign="center">{batteryLabel()}</gtklabel>
        {/if}
      </gtkbox>

      {#if powerMenuOpen}
        <gtkbox class="qs-power-menu" orientation="vertical" spacing={2}>
          <gtkbutton class="qs-power-item" frame={false} onclicked={() => void runPowerAction('lock')}>
            Lock
          </gtkbutton>
          <gtkbutton
            class="qs-power-item"
            frame={false}
            onclicked={() => void runPowerAction('logout')}
          >
            Log out
          </gtkbutton>
          <gtkbutton
            class="qs-power-item"
            frame={false}
            onclicked={() => void runPowerAction('suspend')}
          >
            Sleep
          </gtkbutton>
          <gtkbutton
            class="qs-power-item"
            frame={false}
            onclicked={() => void runPowerAction('reboot')}
          >
            Restart
          </gtkbutton>
          <gtkbutton
            class="qs-power-item danger"
            frame={false}
            onclicked={() => void runPowerAction('poweroff')}
          >
            Power off
          </gtkbutton>
        </gtkbox>
      {/if}
    {/if}
  </gtkbox>
{:else}
  <!-- A closed tray still reports one rect, and an empty one is what makes the
       layer click-through; rendering nothing would leave the whole surface
       claiming input. -->
  <gtkbox width={0} height={0} input></gtkbox>
{/if}
