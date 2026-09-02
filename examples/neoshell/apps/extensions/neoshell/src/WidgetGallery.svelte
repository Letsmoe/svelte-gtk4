<script lang="ts">
  import { cubicIn, cubicOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import WidgetPreview from './WidgetPreview.svelte'
  import { MAX_UNIT_PX, sizePx, spanOf } from './freeform'
  import { recordOf } from './lib'
  import type { BusLike } from './lib'
  import type { ViewRegistryLike } from './widgetCanvas'

  // The widget gallery: a panel that rises from the bottom of the screen and
  // lists every widget the installed extensions declare, grouped by the
  // extension that provides them. A widget is added by dragging its preview
  // onto the desktop, which is also what decides where it lands.
  //
  // This is its own top-layer surface, so it can cover the windows the desktop
  // sits behind. A drag can cross onto the desktop because the scrim already
  // makes the whole screen this surface's input region — the pointer never
  // leaves it, and the drop is announced over the bus with the coordinates the
  // desktop places against.

  const PREVIEW_WIDTH_PX = 176
  // Every preview is the small size. A widget is resized once it is on the
  // desktop, from its own context menu, so the gallery has one thing to show
  // and one thing to drag.
  const PREVIEW_SIZE = 'small'
  const GHOST = sizePx(MAX_UNIT_PX, spanOf(PREVIEW_SIZE))
  const ALL = 'All Widgets'
  // Core Animation's own defaults: a quarter second, decelerating into place and
  // accelerating away, with the exit a little quicker than the entrance.
  const RISE = { y: '100%', duration: 250, easing: cubicOut, opacity: 1 }
  const SINK = { y: '100%', duration: 200, easing: cubicIn, opacity: 1 }

  interface CatalogEntry {
    type: string
    name: string
    category: string
    description: string
  }

  interface DragState {
    type: string
    pointerId: number
    x: number
    y: number
    offsetX: number
    offsetY: number
  }

  let { bus, ui }: { bus: BusLike; ui: ViewRegistryLike } = $props()

  let open = $state(false)
  let catalog = $state<CatalogEntry[]>([])
  let category = $state(ALL)
  let query = $state('')
  let dragging = $state<DragState | null>(null)
  let panel: HTMLElement | undefined = $state()

  const categories = $derived([ALL, ...distinctCategories(catalog)])
  const shown = $derived(filtered(catalog, category, query))

  $effect(() => {
    return bus.subscribe('widgets:gallery', (message) => {
      open = recordOf(message.data).open === true
    })
  })

  $effect(() => {
    return bus.subscribe('widgets.catalog', (message) => {
      catalog = entriesOf(recordOf(message.data).widgets)
    })
  })

  function close(): void {
    open = false
    dragging = null
    bus.publish('widgets:gallery', { open: false })
  }

  function onKey(event: KeyboardEvent): void {
    if (open && event.key === 'Escape') {
      close()
    }
  }

  // The ghost is scaled to the widget's real size, so the point under the
  // pointer stays the same point on the card from pick-up to drop.
  function startDrag(entry: CatalogEntry, event: PointerEvent): void {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    const tile = event.currentTarget as HTMLElement
    tile.setPointerCapture(event.pointerId)
    const box = tile.getBoundingClientRect()
    const ratio = GHOST.width / box.width
    dragging = {
      type: entry.type,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offsetX: (event.clientX - box.left) * ratio,
      offsetY: (event.clientY - box.top) * ratio,
    }
  }

  function moveDrag(event: PointerEvent): void {
    if (dragging === null || dragging.pointerId !== event.pointerId) {
      return
    }
    dragging = { ...dragging, x: event.clientX, y: event.clientY }
  }

  function endDrag(event: PointerEvent): void {
    if (dragging === null || dragging.pointerId !== event.pointerId) {
      return
    }
    const finished = dragging
    dragging = null
    drop(finished, event)
  }

  // A widget let go over the gallery itself was not dropped on the desktop, so
  // nothing is added — the panel is the cancel target.
  function drop(finished: DragState, event: PointerEvent): void {
    if (overPanel(event)) {
      return
    }
    bus.publish('widgets:add', {
      type: finished.type,
      size: PREVIEW_SIZE,
      x: event.clientX - finished.offsetX,
      y: event.clientY - finished.offsetY,
    })
    close()
  }

  function overPanel(event: PointerEvent): boolean {
    if (panel === undefined) {
      return false
    }
    const box = panel.getBoundingClientRect()
    if (event.clientX < box.left || event.clientX > box.right) {
      return false
    }
    return event.clientY >= box.top && event.clientY <= box.bottom
  }

  function distinctCategories(entries: CatalogEntry[]): string[] {
    return [...new Set(entries.map((entry) => entry.category))].sort()
  }

  function filtered(entries: CatalogEntry[], active: string, search: string): CatalogEntry[] {
    const needle = search.trim().toLowerCase()
    return entries.filter((entry) => inCategory(entry, active) && matches(entry, needle))
  }

  function inCategory(entry: CatalogEntry, active: string): boolean {
    if (active === ALL) {
      return true
    }
    return entry.category === active
  }

  function matches(entry: CatalogEntry, needle: string): boolean {
    if (needle === '') {
      return true
    }
    return `${entry.name} ${entry.category} ${entry.description}`.toLowerCase().includes(needle)
  }

  function entriesOf(value: unknown): CatalogEntry[] {
    if (!Array.isArray(value)) {
      return []
    }
    return value.flatMap(entryOf)
  }

  function entryOf(value: unknown): CatalogEntry[] {
    const raw = recordOf(value)
    if (typeof raw.type !== 'string' || typeof raw.name !== 'string') {
      return []
    }
    return [
      {
        type: raw.type,
        name: raw.name,
        category: stringOr(raw.category, 'Other'),
        description: stringOr(raw.description, ''),
      },
    ]
  }

  function stringOr(value: unknown, fallback: string): string {
    if (typeof value !== 'string' || value === '') {
      return fallback
    }
    return value
  }

  function categoryClass(name: string, active: string): string {
    if (name === active) {
      return 'bg-base-content/15 font-medium'
    }
    return 'hover:bg-base-content/10'
  }
</script>

<svelte:window on:keydown={onKey} />

{#if open}
  <!-- The scrim is a click target, not a wash: it dismisses the gallery and it
       is what makes the whole screen this surface's input region, so a drag can
       carry a widget out onto the desktop. It draws nothing, so the topbar and
       the windows underneath are left exactly as they were. -->
  <div
    class="fixed inset-0 z-40"
    data-input-region
    role="presentation"
    onclick={close}
    onpointermove={moveDrag}
    onpointerup={endDrag}
    onpointercancel={endDrag}
  ></div>

  <div
    bind:this={panel}
    class="fixed bottom-0 left-1/2 z-50 flex h-[46vh] w-[60vw] -translate-x-1/2 overflow-hidden
      rounded-t-3xl bg-base-300/80 text-base-content shadow-2xl ring-1 ring-base-content/10
      backdrop-blur-2xl"
    data-input-region
    role="presentation"
    onclick={(event) => event.stopPropagation()}
    in:fly={RISE}
    out:fly={SINK}
  >
    <aside class="flex w-56 shrink-0 flex-col gap-3 border-r border-base-content/10 p-4">
      <input
        class="w-full rounded-lg bg-base-100/60 px-3 py-1.5 text-sm ring-1 ring-base-content/15
          outline-none focus:ring-base-content/40"
        type="search"
        placeholder="Search Widgets"
        bind:value={query}
      />
      <nav class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {#each categories as name (name)}
          <button
            class="rounded-lg px-3 py-2 text-left text-sm {categoryClass(name, category)}"
            type="button"
            onclick={() => (category = name)}
          >
            {name}
          </button>
        {/each}
      </nav>
      <button
        class="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-content"
        type="button"
        onclick={close}
      >
        Done
      </button>
    </aside>

    <section class="min-w-0 flex-1 overflow-y-auto p-6">
      {#if shown.length === 0}
        <p class="text-sm text-base-content/60">No widgets match.</p>
      {:else}
        <div class="flex flex-wrap gap-6">
          {#each shown as entry (entry.type)}
            <!-- The tile is the drag handle. It is not a button: dragging it
                 onto the desktop is the whole interaction, and a click that
                 added a widget somewhere unseen would be a worse one. -->
            <article
              class="flex cursor-grab flex-col gap-2 touch-none active:cursor-grabbing"
              role="presentation"
              onpointerdown={(event) => startDrag(entry, event)}
              onpointermove={moveDrag}
              onpointerup={endDrag}
              onpointercancel={endDrag}
            >
              <WidgetPreview {ui} type={entry.type} size={PREVIEW_SIZE} width={PREVIEW_WIDTH_PX} />
              <div class="min-w-0" style:width={`${PREVIEW_WIDTH_PX}px`}>
                <div class="truncate text-sm font-medium">{entry.name}</div>
                <div class="truncate text-xs text-base-content/60">{entry.category}</div>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </section>
  </div>

  {#if dragging !== null}
    <div
      class="pointer-events-none fixed z-60 overflow-hidden rounded-3xl opacity-80 shadow-2xl"
      style:left={`${dragging.x - dragging.offsetX}px`}
      style:top={`${dragging.y - dragging.offsetY}px`}
    >
      <WidgetPreview {ui} type={dragging.type} size={PREVIEW_SIZE} width={GHOST.width} />
    </div>
  {/if}
{/if}
