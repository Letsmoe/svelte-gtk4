<script lang="ts">
  import { errorOf } from '../../lib/bus'
  import type { BusService } from '../../lib/bus'
  import { deviceIcon, iconName } from './icons'
  import type { BluetoothDevice, BluetoothState } from './types'

  // The Bluetooth detail page: adapter toggle, discovery, and the device list
  // split into paired devices and everything else discovery has turned up.

  const COMMAND_TIMEOUT_MS = 60000
  const LIST_HEIGHT = 256

  let {
    bus,
    bluetoothState,
    devices,
    onBack,
  }: {
    bus: BusService
    bluetoothState: BluetoothState
    devices: BluetoothDevice[]
    onBack: () => void
  } = $props()

  let busy = $state(false)
  let failure = $state('')
  let pendingMac = $state('')

  const paired = $derived(devices.filter((device) => device.paired))
  const discovered = $derived(devices.filter((device) => !device.paired))
  const empty = $derived(emptyMessage(bluetoothState))

  async function runCommand(type: string, data: unknown, mac: string): Promise<void> {
    busy = true
    pendingMac = mac
    failure = ''
    const reply = await bus.call(type, data, COMMAND_TIMEOUT_MS)
    busy = false
    pendingMac = ''
    failure = errorOf(reply)
  }

  // Gtk.Switch emits state-set for a programmatic set_active too, so without
  // the guard the backend republishing its own state would toggle the adapter
  // straight back.
  function togglePower(event: { target: { widget: { get_active(): boolean } } }): void {
    const wanted = event.target.widget.get_active()
    if (wanted === bluetoothState.powered) {
      return
    }
    void runCommand('bluetooth:power', { powered: wanted }, '')
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
      return 'qs-row active'
    }
    return 'qs-row'
  }

  function emptyMessage(state: BluetoothState): string {
    if (!state.available) {
      return 'No Bluetooth adapter on this machine.'
    }
    if (!state.powered) {
      return 'Bluetooth is off.'
    }
    return ''
  }
</script>

<gtkbox orientation="vertical" spacing={12}>
  <gtkbox class="qs-page-header" orientation="horizontal" spacing={8}>
    <gtkbutton class="qs-round-button" frame={false} tooltip="Back" onclicked={onBack}>
      <gtkicon icon={iconName('chevronLeft')} size={18}></gtkicon>
    </gtkbutton>
    <gtklabel class="qs-page-title" hexpand halign="start" ellipsize="end">Bluetooth</gtklabel>
    <gtkbutton
      class="qs-round-button"
      frame={false}
      tooltip="Scan for devices"
      sensitive={!busy && bluetoothState.powered}
      onclicked={scan}
    >
      <gtkicon icon={iconName('refresh')} size={16}></gtkicon>
    </gtkbutton>
    <gtkswitch
      active={bluetoothState.powered}
      valign="center"
      tooltip="Bluetooth enabled"
      sensitive={!busy && bluetoothState.available}
      onstate-set={togglePower}
    ></gtkswitch>
  </gtkbox>

  {#if failure !== ''}
    <gtklabel class="qs-failure" halign="start" wrap xalign={0}>{failure}</gtklabel>
  {/if}

  {#if empty !== ''}
    <gtklabel class="qs-empty" halign="center">{empty}</gtklabel>
  {:else}
    <gtkscrolledwindow
      hscroll="never"
      max-content-height={LIST_HEIGHT}
      propagate-height
      frame={false}
    >
      <gtkbox orientation="vertical" spacing={12}>
        {#if paired.length > 0}
          <gtkbox orientation="vertical" spacing={2}>
            <gtklabel class="qs-section" halign="start">YOUR DEVICES</gtklabel>
            {#each paired as device (device.mac)}
              <gtkbox class={rowClass(device)} orientation="horizontal" clip>
                <gtkbutton
                  class="qs-row-main"
                  frame={false}
                  hexpand
                  sensitive={!busy}
                  onclicked={() => choose(device)}
                >
                  <gtkbox orientation="horizontal" spacing={12} hexpand>
                    <gtkicon icon={iconName(deviceIcon(device.icon))} size={20}></gtkicon>
                    <gtkbox orientation="vertical" hexpand valign="center">
                      <gtklabel class="qs-row-title" halign="start" ellipsize="end">
                        {device.name}
                      </gtklabel>
                      <gtklabel class="qs-row-note" halign="start">{statusOf(device)}</gtklabel>
                    </gtkbox>
                    <gtkspinner spinning valign="center" visible={pendingMac === device.mac}
                    ></gtkspinner>
                  </gtkbox>
                </gtkbutton>
                <gtkbutton
                  class="qs-row-action"
                  frame={false}
                  sensitive={!busy}
                  onclicked={() => forget(device)}
                >
                  Forget
                </gtkbutton>
              </gtkbox>
            {/each}
          </gtkbox>
        {/if}

        <gtkbox orientation="vertical" spacing={2}>
          <gtklabel class="qs-section" halign="start">NEARBY</gtklabel>
          {#if discovered.length === 0}
            <gtklabel class="qs-row-note" halign="start">Nothing found yet — start a scan.</gtklabel>
          {/if}
          {#each discovered as device (device.mac)}
            <gtkbutton
              class="qs-row"
              frame={false}
              sensitive={!busy}
              onclicked={() => choose(device)}
            >
              <gtkbox orientation="horizontal" spacing={12} hexpand>
                <gtkicon icon={iconName(deviceIcon(device.icon))} size={20}></gtkicon>
                <gtklabel class="qs-row-title" hexpand halign="start" ellipsize="end">
                  {device.name}
                </gtklabel>
                {#if pendingMac === device.mac}
                  <gtkspinner spinning valign="center"></gtkspinner>
                {:else}
                  <gtklabel class="qs-row-note" valign="center">Pair</gtklabel>
                {/if}
              </gtkbox>
            </gtkbutton>
          {/each}
        </gtkbox>
      </gtkbox>
    </gtkscrolledwindow>
  {/if}
</gtkbox>
