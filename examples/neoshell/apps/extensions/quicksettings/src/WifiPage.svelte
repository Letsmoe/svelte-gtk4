<script lang="ts">
  import Icon from './Icon.svelte'
  import { signalIcon, signalLabel } from './icons.js'
  import { errorOf } from './lib.js'
  import type { BusLike } from './lib.js'
  import type { NetworkState, WifiNetwork } from './types.js'

  // The Wi-Fi detail page: radio toggle, scan, the network list, the password
  // prompt for a secured network with no saved secret, and the details of the
  // connection in use.

  let {
    bus,
    networkState,
    networks,
    onBack,
  }: {
    bus: BusLike
    networkState: NetworkState
    networks: WifiNetwork[]
    onBack: () => void
  } = $props()

  type Mode = 'list' | 'password' | 'details'

  let mode: Mode = $state('list')
  let selected: WifiNetwork | null = $state(null)
  let password = $state('')
  let busy = $state(false)
  let failure = $state('')
  let passwordInput: HTMLInputElement | null = $state(null)

  const title = $derived(titleOf(mode, selected))

  $effect(() => {
    if (mode !== 'password' || passwordInput === null) {
      return
    }
    passwordInput.focus()
  })

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
    const reply = await bus.call('network:connect', { ssid, password: secret }, 45_000)
    busy = false
    const error = errorOf(reply)
    if (error !== '') {
      failure = error
      return
    }
    backToList()
  }

  function submitPassword(event: SubmitEvent): void {
    event.preventDefault()
    if (selected === null || password === '') {
      return
    }
    void connect(selected.ssid, password)
  }

  async function runCommand(type: string, data: unknown): Promise<void> {
    busy = true
    failure = ''
    const reply = await bus.call(type, data, 30_000)
    busy = false
    failure = errorOf(reply)
  }

  function toggleRadio(): void {
    void runCommand('network:enable', { enabled: !networkState.enabled })
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
      return 'bg-info/20'
    }
    return 'hover:bg-base-content/10'
  }

  function securityLabel(secured: boolean): string {
    if (secured) {
      return 'Protected'
    }
    return 'Open'
  }
</script>

<div class="flex min-h-0 flex-col gap-3">
  <div class="flex items-center gap-2">
    <button
      type="button"
      class="flex h-8 w-8 items-center justify-center rounded-full transition-colors
        hover:bg-base-content/10"
      aria-label="Back"
      onclick={goBack}
    >
      <Icon name="chevronLeft" size={18} />
    </button>
    <span class="min-w-0 flex-1 truncate text-[14px] font-medium">{title}</span>
    {#if mode === 'list'}
      <button
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-full transition-colors
          hover:bg-base-content/10 disabled:opacity-30"
        aria-label="Scan for networks"
        disabled={busy || !networkState.enabled}
        onclick={rescan}
      >
        <Icon name="refresh" size={16} />
      </button>
      <input
        type="checkbox"
        class="toggle toggle-sm toggle-info"
        aria-label="Wi-Fi enabled"
        checked={networkState.enabled}
        disabled={busy || !networkState.available}
        onchange={toggleRadio}
      />
    {/if}
  </div>

  {#if failure !== ''}
    <p class="rounded-lg bg-error/15 px-3 py-2 text-[11px] text-error">{failure}</p>
  {/if}

  {#if mode === 'list'}
    {#if !networkState.available}
      <p class="px-1 py-6 text-center text-[12px] text-base-content/50">
        No Wi-Fi device on this machine.
      </p>
    {:else if !networkState.enabled}
      <p class="px-1 py-6 text-center text-[12px] text-base-content/50">Wi-Fi is off.</p>
    {:else if networks.length === 0}
      <p class="px-1 py-6 text-center text-[12px] text-base-content/50">No networks found.</p>
    {:else}
      <div class="-mr-1 flex max-h-64 flex-col gap-0.5 overflow-y-auto pr-1">
        {#each networks as network (network.ssid)}
          <button
            type="button"
            class="flex items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors
              disabled:opacity-40 {rowClass(network)}"
            disabled={busy}
            onclick={() => choose(network)}
          >
            <Icon name={signalIcon(network.signal, true)} />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[12px] leading-tight">{network.ssid}</span>
              {#if network.active}
                <span class="block text-[10px] leading-tight text-info">Connected</span>
              {:else if network.saved}
                <span class="block text-[10px] leading-tight opacity-50">Saved</span>
              {/if}
            </span>
            {#if network.secured}
              <Icon name="lock" size={13} />
            {/if}
            <Icon name="chevronRight" size={14} />
          </button>
        {/each}
      </div>
    {/if}
  {/if}

  {#if mode === 'password' && selected !== null}
    <form class="flex flex-col gap-3" onsubmit={submitPassword}>
      <p class="text-[11px] text-base-content/60">
        Enter the password for {selected.ssid}.
      </p>
      <input
        bind:this={passwordInput}
        bind:value={password}
        type="password"
        class="input input-sm w-full bg-base-300 text-[12px]"
        placeholder="Password"
        autocomplete="off"
        disabled={busy}
      />
      <div class="flex justify-end gap-2">
        <button type="button" class="btn btn-ghost btn-sm text-[12px]" onclick={backToList}>
          Cancel
        </button>
        <button
          type="submit"
          class="btn btn-sm btn-info text-[12px]"
          disabled={busy || password === ''}
        >
          Connect
        </button>
      </div>
    </form>
  {/if}

  {#if mode === 'details' && selected !== null}
    <dl class="flex flex-col gap-1.5 rounded-xl bg-base-300/60 px-3 py-2.5 text-[11px]">
      <div class="flex justify-between gap-3">
        <dt class="opacity-50">Signal</dt>
        <dd class="tabular-nums">{signalLabel(networkState.signal)} · {networkState.signal}%</dd>
      </div>
      <div class="flex justify-between gap-3">
        <dt class="opacity-50">Security</dt>
        <dd>{securityLabel(networkState.secured)}</dd>
      </div>
      <div class="flex justify-between gap-3">
        <dt class="opacity-50">IPv4</dt>
        <dd class="truncate tabular-nums">{networkState.ipv4}</dd>
      </div>
      <div class="flex justify-between gap-3">
        <dt class="opacity-50">Gateway</dt>
        <dd class="truncate tabular-nums">{networkState.gateway}</dd>
      </div>
      <div class="flex justify-between gap-3">
        <dt class="opacity-50">DNS</dt>
        <dd class="truncate tabular-nums">{networkState.dns.join(', ')}</dd>
      </div>
      <div class="flex justify-between gap-3">
        <dt class="opacity-50">Interface</dt>
        <dd class="tabular-nums">{networkState.device}</dd>
      </div>
    </dl>
    <div class="flex justify-end gap-2">
      <button
        type="button"
        class="btn btn-ghost btn-sm text-[12px]"
        disabled={busy}
        onclick={forget}
      >
        Forget
      </button>
      <button
        type="button"
        class="btn btn-sm text-[12px]"
        disabled={busy}
        onclick={disconnect}
      >
        Disconnect
      </button>
    </div>
  {/if}
</div>
