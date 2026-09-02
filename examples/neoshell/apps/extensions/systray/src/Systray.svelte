<script lang="ts">
  import { iconSourceOf, initialOf, tooltipTextOf, trayItemsOf } from './lib'
  import type { BusLike, TrayItem } from './lib'

  // The tray strip in the top bar, fed by the retained systray.items topic.
  //
  // Two kinds of item end up here. One implements the spec's Activate and
  // ContextMenu, and a click is forwarded straight to it. The other — anything
  // built on libayatana-appindicator, which is most GTK applications —
  // implements neither, and its dbusmenu is the only way in; for those the
  // click opens the menu view instead.

  const ICON_SIZE = 32

  let { bus }: { bus: BusLike } = $props()

  let items: TrayItem[] = $state([])

  $effect(() => {
    return bus.subscribe('systray.items', (message) => {
      items = trayItemsOf(message.data)
    })
  })

  // The layer webview spans the output, so a click's client coordinates are
  // already the screen point the application positions its menu against.
  function send(type: string, item: TrayItem, event: MouseEvent): void {
    bus.publish(type, { key: item.key, x: Math.round(event.clientX), y: Math.round(event.clientY) })
  }

  // The menu is anchored to the icon rather than the pointer, so repeated
  // opens do not walk it across the bar.
  function openMenu(item: TrayItem, event: MouseEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    bus.publish('systray:menu-open', {
      key: item.key,
      x: Math.round(rect.left),
      y: Math.round(rect.bottom + 4),
    })
  }

  // An item that declares itself a menu, or implements no Activate at all, has
  // no action worth calling: its whole interaction is the menu.
  function primary(item: TrayItem, event: MouseEvent): void {
    if (item.hasActivate && !item.itemIsMenu) {
      send('systray:activate', item, event)
      return
    }
    openContext(item, event)
  }

  function context(item: TrayItem, event: MouseEvent): void {
    event.preventDefault()
    openContext(item, event)
  }

  // ContextMenu asks the application to draw its own menu; only an item that
  // exports no menu at all is left to it, since a Wayland client cannot place
  // a popup over the shell's layer surface on its own.
  function openContext(item: TrayItem, event: MouseEvent): void {
    if (item.menuPath !== '') {
      openMenu(item, event)
      return
    }
    send('systray:context', item, event)
  }

  function secondary(item: TrayItem, event: MouseEvent): void {
    if (event.button !== 1) {
      return
    }
    send('systray:secondary', item, event)
  }

  function scroll(item: TrayItem, event: WheelEvent): void {
    event.preventDefault()
    bus.publish('systray:scroll', {
      key: item.key,
      delta: Math.round(event.deltaY),
      orientation: 'vertical',
    })
  }

  const BUTTON_BASE =
    'flex h-5 w-5 cursor-pointer items-center justify-center rounded transition-colors ' +
    'duration-150 hover:bg-base-content/10 '

  // Passive is the spec's "nothing is going on here"; the icon stays visible
  // but recedes, and one needing attention pulses.
  function buttonClass(item: TrayItem): string {
    if (item.status === 'NeedsAttention') {
      return BUTTON_BASE + 'animate-pulse'
    }
    if (item.status === 'Passive') {
      return BUTTON_BASE + 'opacity-50'
    }
    return BUTTON_BASE
  }
</script>

{#if items.length > 0}
  <div class="flex items-center gap-1">
    {#each items as item (item.key)}
      <button
        class={buttonClass(item)}
        title={tooltipTextOf(item)}
        onclick={(event) => primary(item, event)}
        oncontextmenu={(event) => context(item, event)}
        onauxclick={(event) => secondary(item, event)}
        onwheel={(event) => scroll(item, event)}
      >
        {#if iconSourceOf(item, ICON_SIZE) !== ''}
          <img
            class="h-4 w-4 object-contain"
            src={iconSourceOf(item, ICON_SIZE)}
            alt={tooltipTextOf(item)}
          />
        {:else}
          <span class="text-[10px] font-semibold text-base-content/70">{initialOf(item)}</span>
        {/if}
      </button>
    {/each}
  </div>
{/if}
