<script lang="ts">
  import { errorOf } from '../../lib/bus'
  import type { BusService } from '../../lib/bus'
  import { iconName, signalIcon, signalLabel } from './icons'
  import type { NetworkState, WifiNetwork } from './types'

  // The Wi-Fi detail page: radio toggle, scan, the network list, the password
  // prompt for a secured network with no saved secret, and the details of the
  // connection in use.

  const CONNECT_TIMEOUT_MS = 45000
  const COMMAND_TIMEOUT_MS = 30000
  const LIST_HEIGHT = 256

  type Mode = 'list' | 'password' | 'details'

  let {
    bus,
    networkState,
    networks,
    onBack,
  }: {
    bus: BusService
    networkState: NetworkState
    networks: WifiNetwork[]
    onBack: () => void
  } = $props()

  let mode = $state<Mode>('list')
  let selected = $state<WifiNetwork | null>(null)
  let password = $state('')
  let busy = $state(false)
  let failure = $state('')

  const title = $derived(titleOf(mode, selected))

  function titleOf(current: Mode, network: WifiNetwork | null): string {
    if (current === 'list') {
      return 'Wi-Fi'
    }
    if (network === null) {
      return 'Wi-Fi'
    }
    return network.ssid
  }

  function backToList(): void {
    mode = 'list'
    selected = null
    password = ''
    failure = ''
  }

  function goBack(): void {
    if (mode === 'list') {
      onBack()
      return
    }
    backToList()
  }

  // A saved or open network connects straight away; a secured one the machine
  // has never joined needs its passphrase first.
  function choose(network: WifiNetwork): void {
    failure = ''
    selected = network
    if (network.active) {
      mode = 'details'
      return
    }
    if (network.secured && !network.saved) {
      password = ''
      mode = 'password'
      return
    }
    void connect(network.ssid, '')
  }

  async function connect(ssid: string, secret: string): Promise<void> {
    busy = true
    failure = ''
    const reply = await bus.call('network:connect', { ssid, password: secret }, CONNECT_TIMEOUT_MS)
    busy = false
    const error = errorOf(reply)
    if (error !== '') {
      failure = error
      return
    }
    backToList()
  }

  function submitPassword(): void {
    if (selected === null || password === '') {
      return
    }
    void connect(selected.ssid, password)
  }

  function readPassword(event: { target: { widget: { get_text(): string } } }): void {
    password = event.target.widget.get_text()
  }

  async function runCommand(type: string, data: unknown): Promise<void> {
    busy = true
    failure = ''
    const reply = await bus.call(type, data, COMMAND_TIMEOUT_MS)
    busy = false
    failure = errorOf(reply)
  }

  // Gtk.Switch emits state-set for a programmatic set_active too, so the echo
  // of the backend republishing its own state would toggle the radio straight
  // back. The guard is what makes the switch follow the state rather than
  // fight it.
  function toggleRadio(event: { target: { widget: { get_active(): boolean } } }): void {
    const wanted = event.target.widget.get_active()
    if (wanted === networkState.enabled) {
      return
    }
    void runCommand('network:enable', { enabled: wanted })
  }

  function rescan(): void {
    void runCommand('network:scan', {})
  }

  function disconnect(): void {
    void runCommand('network:disconnect', {})
    backToList()
  }

  function forget(): void {
    if (selected === null) {
      return
    }
    void runCommand('network:forget', { ssid: selected.ssid })
    backToList()
  }

  function rowClass(network: WifiNetwork): string {
    if (network.active) {
      return 'qs-row active'
    }
    return 'qs-row'
  }

  function securityLabel(secured: boolean): string {
    if (secured) {
      return 'Protected'
    }
    return 'Open'
  }

  function emptyMessage(state: NetworkState, count: number): string {
    if (!state.available) {
      return 'No Wi-Fi device on this machine.'
    }
    if (!state.enabled) {
      return 'Wi-Fi is off.'
    }
    if (count === 0) {
      return 'No networks found.'
    }
    return ''
  }
</script>

<gtkbox orientation="vertical" spacing={12}>
  <gtkbox class="qs-page-header" orientation="horizontal" spacing={8}>
    <gtkbutton class="qs-round-button" frame={false} tooltip="Back" onclicked={goBack}>
      <gtkicon icon={iconName('chevronLeft')} size={18}></gtkicon>
    </gtkbutton>
    <gtklabel class="qs-page-title" hexpand halign="start" ellipsize="end">{title}</gtklabel>
    {#if mode === 'list'}
      <gtkbutton
        class="qs-round-button"
        frame={false}
        tooltip="Scan for networks"
        sensitive={!busy && networkState.enabled}
        onclicked={rescan}
      >
        <gtkicon icon={iconName('refresh')} size={16}></gtkicon>
      </gtkbutton>
      <gtkswitch
        active={networkState.enabled}
        valign="center"
        tooltip="Wi-Fi enabled"
        sensitive={!busy && networkState.available}
        onstate-set={toggleRadio}
      ></gtkswitch>
    {/if}
  </gtkbox>

  {#if failure !== ''}
    <gtklabel class="qs-failure" halign="start" wrap xalign={0}>{failure}</gtklabel>
  {/if}

  {#if mode === 'list'}
    {@const empty = emptyMessage(networkState, networks.length)}
    {#if empty !== ''}
      <gtklabel class="qs-empty" halign="center">{empty}</gtklabel>
    {:else}
      <gtkscrolledwindow
        hscroll="never"
        max-content-height={LIST_HEIGHT}
        propagate-height
        frame={false}
      >
        <gtkbox orientation="vertical" spacing={2}>
          {#each networks as network (network.ssid)}
            <gtkbutton
              class={rowClass(network)}
              frame={false}
              sensitive={!busy}
              onclicked={() => choose(network)}
            >
              <gtkbox orientation="horizontal" spacing={12} hexpand>
                <gtkicon icon={iconName(signalIcon(network.signal, true))} size={20}></gtkicon>
                <gtkbox orientation="vertical" hexpand valign="center">
                  <gtklabel class="qs-row-title" halign="start" ellipsize="end">
                    {network.ssid}
                  </gtklabel>
                  {#if network.active}
                    <gtklabel class="qs-row-note connected" halign="start">Connected</gtklabel>
                  {:else if network.saved}
                    <gtklabel class="qs-row-note" halign="start">Saved</gtklabel>
                  {/if}
                </gtkbox>
                {#if network.secured}
                  <gtkicon icon={iconName('lock')} size={13} valign="center"></gtkicon>
                {/if}
                <gtkicon icon={iconName('chevronRight')} size={14} valign="center"></gtkicon>
              </gtkbox>
            </gtkbutton>
          {/each}
        </gtkbox>
      </gtkscrolledwindow>
    {/if}
  {/if}

  {#if mode === 'password' && selected !== null}
    <gtkbox orientation="vertical" spacing={12}>
      <gtklabel class="qs-prompt" halign="start" wrap xalign={0}>
        Enter the password for {selected.ssid}.
      </gtklabel>
      <!-- A password entry only takes a keystroke while the layer surface holds
           the keyboard, which the tray's node asks for with keyboard: ondemand. -->
      <gtkpasswordentry
        class="qs-entry"
        placeholder="Password"
        peek
        text={password}
        sensitive={!busy}
        onchanged={readPassword}
        onactivate={submitPassword}
      ></gtkpasswordentry>
      <gtkbox orientation="horizontal" spacing={8} halign="end">
        <gtkbutton class="qs-button" frame={false} onclicked={backToList}>Cancel</gtkbutton>
        <gtkbutton
          class="qs-button primary"
          frame={false}
          sensitive={!busy && password !== ''}
          onclicked={submitPassword}
        >
          Connect
        </gtkbutton>
      </gtkbox>
    </gtkbox>
  {/if}

  {#if mode === 'details' && selected !== null}
    <gtkbox class="qs-details" orientation="vertical" spacing={6}>
      <gtkbox orientation="horizontal" spacing={12}>
        <gtklabel class="qs-detail-key" hexpand halign="start">Signal</gtklabel>
        <gtklabel class="qs-detail-value" tabular halign="end">
          {signalLabel(networkState.signal)} · {networkState.signal}%
        </gtklabel>
      </gtkbox>
      <gtkbox orientation="horizontal" spacing={12}>
        <gtklabel class="qs-detail-key" hexpand halign="start">Security</gtklabel>
        <gtklabel class="qs-detail-value" halign="end">
          {securityLabel(networkState.secured)}
        </gtklabel>
      </gtkbox>
      <gtkbox orientation="horizontal" spacing={12}>
        <gtklabel class="qs-detail-key" hexpand halign="start">IPv4</gtklabel>
        <gtklabel class="qs-detail-value" tabular halign="end" ellipsize="end">
          {networkState.ipv4}
        </gtklabel>
      </gtkbox>
      <gtkbox orientation="horizontal" spacing={12}>
        <gtklabel class="qs-detail-key" hexpand halign="start">Gateway</gtklabel>
        <gtklabel class="qs-detail-value" tabular halign="end" ellipsize="end">
          {networkState.gateway}
        </gtklabel>
      </gtkbox>
      <gtkbox orientation="horizontal" spacing={12}>
        <gtklabel class="qs-detail-key" hexpand halign="start">DNS</gtklabel>
        <gtklabel class="qs-detail-value" tabular halign="end" ellipsize="end">
          {networkState.dns.join(', ')}
        </gtklabel>
      </gtkbox>
      <gtkbox orientation="horizontal" spacing={12}>
        <gtklabel class="qs-detail-key" hexpand halign="start">Interface</gtklabel>
        <gtklabel class="qs-detail-value" tabular halign="end">{networkState.device}</gtklabel>
      </gtkbox>
    </gtkbox>
    <gtkbox orientation="horizontal" spacing={8} halign="end">
      <gtkbutton class="qs-button" frame={false} sensitive={!busy} onclicked={forget}>
        Forget
      </gtkbutton>
      <gtkbutton class="qs-button" frame={false} sensitive={!busy} onclicked={disconnect}>
        Disconnect
      </gtkbutton>
    </gtkbox>
  {/if}
</gtkbox>
