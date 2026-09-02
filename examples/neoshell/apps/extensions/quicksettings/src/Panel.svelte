<script lang="ts">
  import Icon from './Icon.svelte'
  import Tile from './Tile.svelte'
  import SliderRow from './SliderRow.svelte'
  import WifiPage from './WifiPage.svelte'
  import BluetoothPage from './BluetoothPage.svelte'
  import { deviceIcon, signalIcon, signalLabel } from './icons.js'
  import { arrayOf, numberOf, recordOf, stringOf } from './lib.js'
  import type { BusLike } from './lib.js'
  import type {
    BluetoothDevice,
    BluetoothState,
    NetworkState,
    WifiNetwork,
  } from './types.js'

  // The quick settings panel: a ChromeOS-style tray hanging under the bar,
  // opened by the clock. The wrapper this renders into spans the whole output
  // so the scrim can catch a click anywhere; while closed nothing but a
  // zero-size marker is drawn, which reports an empty input region and leaves
  // the desktop click-through.
  //
  //   quicksettings:toggle / :open / :close   drive visibility

  let { bus, top = 36 }: { bus: BusLike; top?: number } = $props()

  type Page = 'main' | 'wifi' | 'bluetooth'

  const SCREENSHOT_COMMAND = 'grim -g "$(slurp)"'

  let open = $state(false)
  let page: Page = $state('main')
  let powerMenuOpen = $state(false)

  let network: NetworkState = $state(emptyNetworkState())
  let networks: WifiNetwork[] = $state([])
  let bluetooth: BluetoothState = $state(emptyBluetoothState())
  let devices: BluetoothDevice[] = $state([])
  let volume = $state(0)
  let muted = $state(false)
  let brightness = $state(0)
  let brightnessAvailable = $state(false)
  let batteryPercent = $state(-1)
  let batteryStatus = $state('')
  let doNotDisturb = $state(false)
  let keyboardLayout = $state('')

  const connectedDevice = $derived(devices.find((device) => device.connected))

  $effect(() => {
    const unsubscribers = [
      bus.subscribe('quicksettings:toggle', () => setOpen(!open)),
      bus.subscribe('quicksettings:open', () => setOpen(true)),
      bus.subscribe('quicksettings:close', () => setOpen(false)),
      bus.subscribe('network.state', (message) => {
        network = networkStateOf(message.data)
      }),
      bus.subscribe('network.networks', (message) => {
        networks = networksOf(message.data)
      }),
      bus.subscribe('bluetooth.state', (message) => {
        bluetooth = bluetoothStateOf(message.data)
      }),
      bus.subscribe('bluetooth.devices', (message) => {
        devices = devicesOf(message.data)
      }),
      bus.subscribe('system.volume', (message) => {
        applyVolume(message.data)
      }),
      bus.subscribe('system.brightness', (message) => {
        applyBrightness(message.data)
      }),
      bus.subscribe('system.battery', (message) => {
        applyBattery(message.data)
      }),
      bus.subscribe('config', (message) => {
        applyConfig(message.data)
      }),
      bus.subscribe('hypr.event', (message) => {
        applyKeyboardLayout(message.data)
      }),
    ]
    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe()
      }
    }
  })

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

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !open) {
      return
    }
    if (page !== 'main') {
      page = 'main'
      return
    }
    close()
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

  function applyConfig(data: unknown): void {
    const notifications = recordOf(recordOf(data).notifications)
    doNotDisturb = notifications.doNotDisturb === true
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
    void bus.call('system:setVolume', { volume: percent }, 5_000)
  }

  function toggleMute(): void {
    muted = !muted
    void bus.call('system:setMuted', { muted }, 5_000)
  }

  function setBrightness(percent: number): void {
    brightness = percent
    void bus.call('system:setBrightness', { percent }, 5_000)
  }

  function toggleDoNotDisturb(): void {
    doNotDisturb = !doNotDisturb
    bus.publish('config:set', { key: 'notifications.doNotDisturb', value: doNotDisturb })
  }

  function captureScreen(): void {
    close()
    void bus.call('hypr:dispatch', { dispatcher: 'exec', arg: SCREENSHOT_COMMAND }, 5_000)
  }

  function runPowerAction(action: string): void {
    close()
    void bus.call('system:power', { action }, 5_000)
  }

  function toggleWifi(): void {
    void bus.call('network:enable', { enabled: !network.enabled }, 15_000)
  }

  function toggleBluetooth(): void {
    void bus.call('bluetooth:power', { powered: !bluetooth.powered }, 15_000)
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
    if (batteryPercent < 0) {
      return ''
    }
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

  function stringListOf(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return []
    }
    return value.filter((entry) => typeof entry === 'string')
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

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div class="fixed inset-0" data-input-region>
    <button
      type="button"
      class="absolute inset-0 cursor-default"
      aria-label="Close quick settings"
      onclick={close}
    ></button>
    <div
      class="panel absolute right-2.5 flex w-[20.5rem] flex-col gap-2.5 rounded-3xl
        border border-base-content/8 bg-base-200 p-2.5 text-base-content
        shadow-2xl shadow-black/60"
      style:top="{top}px"
    >
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
        <div class="grid grid-cols-4 gap-2">
          <div class="col-span-2">
            <Tile
              icon={signalIcon(network.signal, network.connected)}
              title={wifiTitle()}
              subtitle={wifiSubtitle()}
              active={network.enabled}
              disabled={!network.available}
              onActivate={toggleWifi}
              onOpen={() => (page = 'wifi')}
            />
          </div>
          <Tile compact icon="camera" title="Screen capture" onActivate={captureScreen} />
          <Tile
            compact
            icon="moon"
            title="Do not disturb"
            active={doNotDisturb}
            onActivate={toggleDoNotDisturb}
          />

          <div class="col-span-2">
            <Tile
              icon={bluetoothIcon()}
              title="Bluetooth"
              subtitle={bluetoothSubtitle()}
              active={bluetooth.powered}
              disabled={!bluetooth.available}
              onActivate={toggleBluetooth}
              onOpen={() => (page = 'bluetooth')}
            />
          </div>
          <div class="col-span-2">
            <Tile icon="cast" title="Cast screen" subtitle="Unavailable" disabled />
          </div>

          <div class="col-span-2">
            <Tile icon="share" title="Nearby share" subtitle="Unavailable" disabled />
          </div>
          <div class="col-span-2">
            <Tile icon="keyboard" title="Keyboard" subtitle={keyboardSubtitle()} disabled />
          </div>
        </div>

        <div class="flex flex-col gap-2">
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
        </div>

        <div class="flex items-center gap-1 border-t border-base-content/10 px-0.5 pt-1.5">
          <button
            type="button"
            class="flex items-center gap-0.5 rounded-full px-1.5 py-1 text-base-content/70
              transition-colors hover:bg-base-content/10"
            aria-label="Power options"
            onclick={() => (powerMenuOpen = !powerMenuOpen)}
          >
            <Icon name="power" size={16} />
            <Icon name="chevronDown" size={12} />
          </button>
          <span class="flex-1"></span>
          {#if batteryPercent >= 0}
            <span class="px-1 text-[10.5px] tabular-nums text-base-content/60">
              {batteryLabel()}
            </span>
          {/if}
        </div>

        {#if powerMenuOpen}
          <div class="flex flex-col gap-0.5 rounded-2xl bg-base-300/70 p-1">
            <button
              type="button"
              class="rounded-xl px-3 py-1.5 text-left text-[12px] hover:bg-base-content/10"
              onclick={() => runPowerAction('lock')}
            >
              Lock
            </button>
            <button
              type="button"
              class="rounded-xl px-3 py-1.5 text-left text-[12px] hover:bg-base-content/10"
              onclick={() => runPowerAction('logout')}
            >
              Log out
            </button>
            <button
              type="button"
              class="rounded-xl px-3 py-1.5 text-left text-[12px] hover:bg-base-content/10"
              onclick={() => runPowerAction('suspend')}
            >
              Sleep
            </button>
            <button
              type="button"
              class="rounded-xl px-3 py-1.5 text-left text-[12px] hover:bg-base-content/10"
              onclick={() => runPowerAction('reboot')}
            >
              Restart
            </button>
            <button
              type="button"
              class="rounded-xl px-3 py-1.5 text-left text-[12px] text-error
                hover:bg-error/15"
              onclick={() => runPowerAction('poweroff')}
            >
              Power off
            </button>
          </div>
        {/if}
      {/if}
    </div>
  </div>
{:else}
  <!-- A closed tray still reports one rect, and an empty one is what makes the
       layer click-through; rendering nothing would fall back to the wrapper. -->
  <div
    class="pointer-events-none fixed top-0 left-0 h-0 w-0"
    data-input-region
    aria-hidden="true"
  ></div>
{/if}

<style>
  /* The tray unrolls from under the bar rather than fading, so it reads as
     attached to the edge the clock lives on. */
  .panel {
    animation: unroll 160ms cubic-bezier(0.2, 0.7, 0.3, 1);
    transform-origin: top center;
  }

  @keyframes unroll {
    from {
      clip-path: inset(0 0 100% 0);
      opacity: 0;
    }
    to {
      clip-path: inset(0 0 0 0);
      opacity: 1;
    }
  }
</style>
