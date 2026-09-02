<script lang="ts">
  import MenuList from './MenuList.svelte'
  import { menuEntriesOf, recordOf } from './lib'
  import type { BusLike, MenuEntry } from './lib'

  // The popup for a tray item's dbusmenu. It is its own top-level view rather
  // than part of the indicator: the bar is thirty pixels tall and a menu is
  // not, so the panel needs a wrapper spanning the output. While closed
  // nothing but a zero-size marker is drawn, which reports an empty input
  // region and leaves the desktop click-through.
  //
  //   systray:menu-open {key, x, y}   published by the indicator
  //   systray:menu-close

  const MENU_WIDTH = 240
  const EDGE_GAP = 8

  let { bus }: { bus: BusLike } = $props()

  let open = $state(false)
  let entries: MenuEntry[] = $state([])
  let failed = $state(false)
  let itemKey = $state('')
  let anchorX = $state(0)
  let anchorY = $state(0)

  $effect(() => {
    const unsubscribers = [
      bus.subscribe('systray:menu-open', (message) => {
        void openFor(message.data)
      }),
      bus.subscribe('systray:menu-close', () => close()),
    ]
    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe()
      }
    }
  })

  async function openFor(data: unknown): Promise<void> {
    const request = recordOf(data)
    if (typeof request.key !== 'string') {
      return
    }
    itemKey = request.key
    anchorX = numberOf(request.x)
    anchorY = numberOf(request.y)
    entries = []
    failed = false
    open = true
    await load(request.key)
  }

  // The layout is fetched per open rather than cached: applications rewrite
  // their menu between showings, and the daemon's AboutToShow is what makes
  // them fill it in the first place.
  async function load(key: string): Promise<void> {
    const reply = recordOf(await bus.call('systray:menu', { key }))
    if (key !== itemKey || !open) {
      return
    }
    entries = menuEntriesOf(reply.entries)
    failed = entries.length === 0
  }

  function close(): void {
    open = false
    entries = []
    itemKey = ''
  }

  function activate(entry: MenuEntry): void {
    bus.publish('systray:menuevent', { key: itemKey, id: entry.id })
    close()
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && open) {
      close()
    }
  }

  function numberOf(value: unknown): number {
    if (typeof value === 'number') {
      return value
    }
    return 0
  }

  // The menu hangs under its icon, pulled left when the icon sits near the
  // right edge — which is where the tray always is.
  const leftEdge = $derived(
    Math.max(EDGE_GAP, Math.min(anchorX, window.innerWidth - MENU_WIDTH - EDGE_GAP)),
  )
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div class="fixed inset-0" data-input-region>
    <button
      type="button"
      class="absolute inset-0 cursor-default"
      aria-label="Close tray menu"
      onclick={close}
      oncontextmenu={(event) => {
        event.preventDefault()
        close()
      }}
    ></button>
    <div class="absolute" style:top="{anchorY}px" style:left="{leftEdge}px">
      {#if failed}
        <div
          class="rounded-xl border border-base-content/10 bg-base-200 px-3 py-2 text-[12px]
            text-base-content/60 shadow-2xl shadow-black/60"
        >
          No menu
        </div>
      {:else if entries.length > 0}
        <MenuList {entries} onActivate={activate} />
      {/if}
    </div>
  </div>
{:else}
  <!-- A closed menu still reports one rect, and an empty one is what makes the
       layer click-through; rendering nothing would fall back to the wrapper. -->
  <div
    class="pointer-events-none fixed top-0 left-0 h-0 w-0"
    data-input-region
    aria-hidden="true"
  ></div>
{/if}
