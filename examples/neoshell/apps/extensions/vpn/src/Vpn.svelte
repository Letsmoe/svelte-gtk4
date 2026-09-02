<script lang="ts">
  import ShieldCheckIcon from 'phosphor-svelte/lib/ShieldCheckIcon'
  import ShieldSlashIcon from 'phosphor-svelte/lib/ShieldSlashIcon'
  import { emptyVpnState, vpnStateOf } from './lib'
  import type { BusLike, VpnState } from './lib'

  // The VPN indicator in the top bar, fed by the retained vpn.state topic. A
  // machine with no VPN profile draws nothing at all — the bar reserves no
  // space for it — and a click toggles the tunnel.

  const ICON_SIZE = 16

  let { bus }: { bus: BusLike } = $props()

  let vpn: VpnState = $state(emptyVpnState())
  let pending = $state(false)

  $effect(() => {
    return bus.subscribe('vpn.state', (message) => {
      vpn = vpnStateOf(message.data)
      pending = false
    })
  })

  // nmcli takes seconds to bring a tunnel up or down; the indicator dims for
  // the whole call so a slow handshake does not read as a click that missed.
  async function toggle(): Promise<void> {
    pending = true
    try {
      await bus.call('vpn:toggle', {})
    } finally {
      pending = false
    }
  }

  const BUTTON_BASE = `flex h-6 cursor-pointer items-center gap-1.5 rounded-lg px-1.5
    transition-colors duration-150 hover:bg-base-content/10`

  const buttonClass = $derived(buttonClassOf(vpn.connected, pending))
  const label = $derived(labelOf(vpn))

  function buttonClassOf(connected: boolean, busy: boolean): string {
    const tone = toneOf(connected)
    if (busy) {
      return `${BUTTON_BASE} ${tone} opacity-50`
    }
    return `${BUTTON_BASE} ${tone}`
  }

  function toneOf(connected: boolean): string {
    if (connected) {
      return 'text-base-content'
    }
    return 'text-base-content/40'
  }

  function labelOf(state: VpnState): string {
    if (!state.connected) {
      return 'VPN off'
    }
    if (state.ipv4 === '') {
      return state.name
    }
    return `${state.name} — ${state.ipv4}`
  }
</script>

{#if vpn.available}
  <button
    class={buttonClass}
    onclick={toggle}
    disabled={pending}
    title={label}
    aria-label={label}
  >
    {#if vpn.connected}
      <ShieldCheckIcon size={ICON_SIZE} weight="fill" />
      <span class="max-w-32 truncate">{vpn.name}</span>
    {:else}
      <ShieldSlashIcon size={ICON_SIZE} />
    {/if}
  </button>
{/if}
