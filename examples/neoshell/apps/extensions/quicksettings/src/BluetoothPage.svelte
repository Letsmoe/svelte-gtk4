<script lang="ts">
  import Icon from './Icon.svelte'
  import { deviceIcon } from './icons.js'
  import { errorOf } from './lib.js'
  import type { BusLike } from './lib.js'
  import type { BluetoothDevice, BluetoothState } from './types.js'

  // The Bluetooth detail page: adapter toggle, discovery, and the device list
  // split into paired devices and everything else discovery has turned up.

  let {
    bus,
    bluetoothState,
    devices,
    onBack,
  }: {
    bus: BusLike
    bluetoothState: BluetoothState
    devices: BluetoothDevice[]
    onBack: () => void
  } = $props()

  let busy = $state(false)
  let failure = $state('')
  let pendingMac = $state('')

  const paired = $derived(devices.filter((device) => device.paired))
  const discovered = $derived(devices.filter((device) => !device.paired))

  async function runCommand(type: string, data: unknown, mac: string): Promise<void> {
    busy = true
    pendingMac = mac
    failure = ''
    const reply = await bus.call(type, data, 60_000)
    busy = false
    pendingMac = ''
    failure = errorOf(reply)
  }

  function togglePower(): void {
    void runCommand('bluetooth:power', { powered: !bluetoothState.powered }, '')
  }

  function scan(): void {
    void runCommand('bluetooth:scan', {}, '')
  }

  // A paired device toggles its connection; an unpaired one is paired,
  // trusted, and connected in one step by the backend.
  function choose(device: BluetoothDevice): void {
    if (!device.paired) {
      void runCommand('bluetooth:pair', { mac: device.mac }, device.mac)
      return
    }
    if (device.connected) {
      void runCommand('bluetooth:disconnect', { mac: device.mac }, device.mac)
      return
    }
    void runCommand('bluetooth:connect', { mac: device.mac }, device.mac)
  }

  function forget(device: BluetoothDevice): void {
    void runCommand('bluetooth:forget', { mac: device.mac }, device.mac)
  }

  function statusOf(device: BluetoothDevice): string {
    if (device.connected && device.battery >= 0) {
      return `Connected · ${device.battery}%`
    }
    if (device.connected) {
      return 'Connected'
    }
    if (device.paired) {
      return 'Paired'
    }
    return ''
  }

  function rowClass(device: BluetoothDevice): string {
    if (device.connected) {
      return 'bg-info/20'
    }
    return 'hover:bg-base-content/10'
  }
</script>

<div class="flex min-h-0 flex-col gap-3">
  <div class="flex items-center gap-2">
    <button
      type="button"
      class="flex h-8 w-8 items-center justify-center rounded-full transition-colors
        hover:bg-base-content/10"
      aria-label="Back"
      onclick={onBack}
    >
      <Icon name="chevronLeft" size={18} />
    </button>
    <span class="min-w-0 flex-1 truncate text-[14px] font-medium">Bluetooth</span>
    <button
      type="button"
      class="flex h-8 w-8 items-center justify-center rounded-full transition-colors
        hover:bg-base-content/10 disabled:opacity-30"
      aria-label="Scan for devices"
      disabled={busy || !bluetoothState.powered}
      onclick={scan}
    >
      <Icon name="refresh" size={16} />
    </button>
    <input
      type="checkbox"
      class="toggle toggle-sm toggle-info"
      aria-label="Bluetooth enabled"
      checked={bluetoothState.powered}
      disabled={busy || !bluetoothState.available}
      onchange={togglePower}
    />
  </div>

  {#if failure !== ''}
    <p class="rounded-lg bg-error/15 px-3 py-2 text-[11px] text-error">{failure}</p>
  {/if}

  {#if !bluetoothState.available}
    <p class="px-1 py-6 text-center text-[12px] text-base-content/50">
      No Bluetooth adapter on this machine.
    </p>
  {:else if !bluetoothState.powered}
    <p class="px-1 py-6 text-center text-[12px] text-base-content/50">Bluetooth is off.</p>
  {:else}
    <div class="-mr-1 flex max-h-64 flex-col gap-3 overflow-y-auto pr-1">
      {#if paired.length > 0}
        <div class="flex flex-col gap-0.5">
          <p class="px-2.5 py-1 text-[10px] tracking-wide uppercase opacity-40">
            Your devices
          </p>
          {#each paired as device (device.mac)}
            <div class="flex items-center rounded-xl transition-colors {rowClass(device)}">
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2 text-left
                  disabled:opacity-40"
                disabled={busy}
                onclick={() => choose(device)}
              >
                <Icon name={deviceIcon(device.icon)} />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[12px] leading-tight">{device.name}</span>
                  <span class="block text-[10px] leading-tight opacity-50">
                    {statusOf(device)}
                  </span>
                </span>
                {#if pendingMac === device.mac}
                  <span class="loading loading-spinner loading-xs"></span>
                {/if}
              </button>
              <button
                type="button"
                class="px-2.5 py-2 text-[10px] opacity-40 transition-opacity hover:opacity-100"
                disabled={busy}
                onclick={() => forget(device)}
              >
                Forget
              </button>
            </div>
          {/each}
        </div>
      {/if}

      <div class="flex flex-col gap-0.5">
        <p class="px-2.5 py-1 text-[10px] tracking-wide uppercase opacity-40">Nearby</p>
        {#if discovered.length === 0}
          <p class="px-2.5 py-2 text-[11px] opacity-40">
            Nothing found yet — start a scan.
          </p>
        {/if}
        {#each discovered as device (device.mac)}
          <button
            type="button"
            class="flex items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors
              disabled:opacity-40 hover:bg-base-content/10"
            disabled={busy}
            onclick={() => choose(device)}
          >
            <Icon name={deviceIcon(device.icon)} />
            <span class="min-w-0 flex-1 truncate text-[12px]">{device.name}</span>
            {#if pendingMac === device.mac}
              <span class="loading loading-spinner loading-xs"></span>
            {:else}
              <span class="text-[10px] opacity-40">Pair</span>
            {/if}
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>
