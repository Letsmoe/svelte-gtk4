<script lang="ts">
  import { subscribeTo } from '../../lib/bus'
  import type { ViewProps } from '../../host/plugins/views'
  import { recordOf, stringOf } from '../../lib/record'
  import WidgetPreview from './WidgetPreview.svelte'

  // The widget gallery: a panel that rises from the bottom of the screen and
  // lists every widget the installed extensions declare, grouped by the
  // extension that provides them.
  //
  // In the webview build a widget was added by dragging its preview onto the
  // desktop, which is also what decided where it landed. Both surfaces were one
  // webview there, so the pointer never left it. They are two layer-shell
  // windows here and a pointer grab does not cross between them, so the tile is
  // a button: clicking it adds the widget and the desktop's layout places it.
  // That is what `addWidget` already does for a widget added without a point.
  //
  // While closed the panel draws a zero-size input marker rather than nothing —
  // an empty input region is what leaves the bottom of the screen
  // click-through, and a surface with no marked widget claims the whole thing.

  const PREVIEW_WIDTH_PX = 176
  // Every preview is the small size. A widget is resized once it is on the
  // desktop, from its own context menu, so the gallery has one thing to show
  // and one thing to add.
  const PREVIEW_SIZE = 'small'
  const ALL = 'All Widgets'
  const WIDTH_FRACTION = 0.6
  const HEIGHT_FRACTION = 0.46
  const FALLBACK_SIZE = { width: 1152, height: 442 }
  const SIDEBAR_WIDTH = 224
  const RISE_MS = 250

  interface CatalogEntry {
    type: string
    name: string
    category: string
    description: string
  }

  let { bus, registry }: ViewProps = $props()

  let open = $state(false)
  let catalog = $state<CatalogEntry[]>([])
  let category = $state(ALL)
  let query = $state('')
  let viewport = $state(FALLBACK_SIZE)
  // The registry is outside Svelte's reactivity, so a widget provider that
  // registers after the gallery is up is picked up by bumping this.
  let generation = $state(0)

  const categories = $derived([ALL, ...distinctCategories(catalog)])
  const shown = $derived(filtered(catalog, category, query))
  const panelWidth = $derived(Math.round(viewport.width * WIDTH_FRACTION))
  const panelHeight = $derived(Math.round(viewport.height * HEIGHT_FRACTION))

  $effect(() =>
    subscribeTo(bus, 'widgets:gallery', (message) => {
      open = recordOf(message.data).open === true
    }),
  )

  $effect(() =>
    subscribeTo(bus, 'widgets.catalog', (message) => {
      catalog = entriesOf(recordOf(message.data).widgets)
    }),
  )

  // The panel is a fraction of the output, and the gallery's own window is
  // anchored to one edge — so its size comes from the compositor bridge the
  // same way the desktop's viewport does.
  $effect(() =>
    subscribeTo(bus, 'hypr.monitors', (message) => {
      applyMonitor(message.data)
    }),
  )

  $effect(() =>
    registry.onChange(() => {
      generation += 1
    }),
  )

  function applyMonitor(data: unknown): void {
    if (!Array.isArray(data) || data.length === 0) {
      return
    }
    const monitor = recordOf(data[0])
    if (typeof monitor.width !== 'number' || typeof monitor.height !== 'number') {
      return
    }
    viewport = { width: monitor.width, height: monitor.height }
  }

  function close(): void {
    open = false
    bus.publish('widgets:gallery', { open: false })
  }

  function add(entry: CatalogEntry): void {
    bus.publish('widgets:add', { type: entry.type, size: PREVIEW_SIZE })
    close()
  }

  function readQuery(event: { target: { widget: { get_text(): string } } }): void {
    query = event.target.widget.get_text()
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
        description: stringOf(raw.description),
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
      return 'gallery-category active'
    }
    return 'gallery-category'
  }
</script>

<gtkbox orientation="vertical" halign="center" valign="end">
  <gtkrevealer reveal={open} transition="slide-up" duration={RISE_MS}>
    <gtkbox
      class="gallery"
      orientation="horizontal"
      width={panelWidth}
      height={panelHeight}
      clip
      input={open}
    >
      <gtkbox class="gallery-sidebar" orientation="vertical" spacing={12} width={SIDEBAR_WIDTH}>
        <gtksearchentry
          class="gallery-search"
          placeholder="Search Widgets"
          text={query}
          onsearch-changed={readQuery}
        ></gtksearchentry>

        <gtkscrolledwindow hscroll="never" vexpand frame={false}>
          <gtkbox orientation="vertical" spacing={2}>
            {#each categories as name (name)}
              <gtkbutton
                class={categoryClass(name, category)}
                frame={false}
                onclicked={() => (category = name)}
              >
                <gtklabel hexpand halign="start" ellipsize="end">{name}</gtklabel>
              </gtkbutton>
            {/each}
          </gtkbox>
        </gtkscrolledwindow>

        <gtkbutton class="gallery-done" frame={false} onclicked={close}>Done</gtkbutton>
      </gtkbox>

      <gtkscrolledwindow class="gallery-body" hscroll="never" hexpand vexpand frame={false}>
        {#if shown.length === 0}
          <gtklabel class="gallery-empty" halign="center" valign="start">
            No widgets match.
          </gtklabel>
        {:else}
          <!-- A flow box wraps the tiles the way the webview's flex-wrap did,
               and it is the one container that reflows when the panel is a
               fraction of an output whose width is not known up front. -->
          <gtkflowbox
            class="gallery-tiles"
            orientation="horizontal"
            spacing={24}
            selection="none"
            halign="start"
            valign="start"
            max-per-line={8}
          >
            {#each shown as entry (entry.type)}
              <gtkpressable
                class="gallery-tile"
                orientation="vertical"
                spacing={8}
                width={PREVIEW_WIDTH_PX}
                tooltip={entry.description}
                onpress={() => add(entry)}
              >
                <WidgetPreview
                  {bus}
                  {registry}
                  {generation}
                  type={entry.type}
                  size={PREVIEW_SIZE}
                  width={PREVIEW_WIDTH_PX}
                />
                <gtklabel class="gallery-tile-name" halign="start" ellipsize="end">
                  {entry.name}
                </gtklabel>
                <gtklabel class="gallery-tile-category" halign="start" ellipsize="end">
                  {entry.category}
                </gtklabel>
              </gtkpressable>
            {/each}
          </gtkflowbox>
        {/if}
      </gtkscrolledwindow>
    </gtkbox>
  </gtkrevealer>

  {#if !open}
    <gtkbox width={0} height={0} input></gtkbox>
  {/if}
</gtkbox>
