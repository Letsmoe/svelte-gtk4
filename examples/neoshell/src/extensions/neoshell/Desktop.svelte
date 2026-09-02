<script lang="ts">
  import { subscribeTo } from '../../lib/bus'
  import type { ViewProps } from '../../host/plugins/views'
  import { recordOf } from '../../lib/record'
  import AlignmentGuides from './AlignmentGuides.svelte'
  import ContextMenu from './ContextMenu.svelte'
  import DesktopIcons from './DesktopIcons.svelte'
  import WidgetSlot from './WidgetSlot.svelte'
  import { DesktopStore } from './desktopStore.svelte'
  import type { MenuItem } from './desktopStore.svelte'
  import type { Point, Size } from './freeform'
  import { dragOf, pressOf, SECONDARY_BUTTON } from './gestures'

  // The desktop: the background-layer view that owns everything behind the
  // windows — the desktop folder's icons and the widget grid. Icons and widgets
  // share one grid, so this node also owns what spans both: the rubber band
  // that selects icons, the background context menu, and the widget placement
  // both halves resolve against.
  //
  // Everything is an overlay child positioned by margins. GTK has no absolute
  // positioning and a Gtk.Fixed reads its coordinates once at insertion, so an
  // overlay child aligned to the top-left with margins is what carries a point
  // that moves.

  const CALL_TIMEOUT_MS = 10000

  interface WallpaperEntry {
    name: string
    path: string
  }

  let { bus, registry, args }: ViewProps = $props()

  const store = new DesktopStore(bus)

  let band = $state<{ x: number; y: number; width: number; height: number } | null>(null)
  let preview = $state<{ point: Point; box: Size; allowed: boolean } | null>(null)
  // The registry is outside Svelte's reactivity, so a widget provider that
  // registers after the desktop is up is picked up by bumping this.
  let generation = $state(0)

  $effect(() => {
    store.setSeeds(recordOf(args).widgets)
  })

  $effect(() =>
    subscribeTo(bus, 'config', (message) => {
      store.applyConfig(message.data)
    }),
  )

  // The desktop window is anchored to every edge, so the output's size is the
  // viewport. There is no window-resize event to bind to here; the compositor
  // bridge already publishes the geometry.
  $effect(() =>
    subscribeTo(bus, 'hypr.monitors', (message) => {
      applyMonitor(message.data)
    }),
  )

  $effect(() =>
    subscribeTo(bus, 'widgets:add', (message) => {
      const request = recordOf(message.data)
      store.addWidget(String(request.type), String(request.size), droppedPoint(request))
    }),
  )

  $effect(() =>
    registry.onChange(() => {
      generation += 1
    }),
  )

  // Config is the desktop's state file, not just its seed: whatever the
  // resolved layout ends up being — icons the folder flowed into place, a
  // widget displaced off a stale cell — is written back once it settles.
  $effect(() => {
    store.schedulePersist(store.layout)
    return () => store.cancelPersist()
  })

  function applyMonitor(data: unknown): void {
    if (!Array.isArray(data) || data.length === 0) {
      return
    }
    const monitor = recordOf(data[0])
    if (typeof monitor.width !== 'number' || typeof monitor.height !== 'number') {
      return
    }
    store.setViewport(monitor.width, monitor.height)
  }

  // The gallery is a different window, so a widget dragged onto the desktop
  // arrives as coordinates rather than as a drop event. Both cover the output,
  // so the coordinates need no translation.
  function droppedPoint(request: Record<string, unknown>): Point | undefined {
    const { x, y } = request
    if (typeof x !== 'number' || typeof y !== 'number') {
      return undefined
    }
    return { x, y }
  }

  function handlePress(event: { detail: unknown }): void {
    const press = pressOf(event)
    if (press.button !== SECONDARY_BUTTON) {
      store.clearSelection()
      return
    }
    store.clearSelection()
    void openMenu(press.x, press.y)
  }

  function startBand(event: { detail: unknown }): void {
    const drag = dragOf(event)
    store.clearSelection()
    band = { x: drag.startX, y: drag.startY, width: 0, height: 0 }
  }

  function moveBand(event: { detail: unknown }): void {
    if (band === null) {
      return
    }
    const drag = dragOf(event)
    band = {
      x: Math.min(drag.startX, drag.x),
      y: Math.min(drag.startY, drag.y),
      width: Math.abs(drag.dx),
      height: Math.abs(drag.dy),
    }
    store.selectPaths(pathsInBand())
  }

  function endBand(): void {
    band = null
  }

  // Icon cells are known geometry, so the band is intersected against computed
  // rects rather than against measured widgets.
  function pathsInBand(): string[] {
    if (band === null) {
      return []
    }
    const hit: string[] = []
    for (const [path, point] of store.layout.icons) {
      if (intersects(point)) {
        hit.push(path)
      }
    }
    return hit
  }

  function intersects(point: Point): boolean {
    if (band === null) {
      return false
    }
    const { width, height } = store.layout.iconSize
    if (point.x + width < band.x || point.x > band.x + band.width) {
      return false
    }
    return !(point.y + height < band.y || point.y > band.y + band.height)
  }

  async function openMenu(x: number, y: number): Promise<void> {
    store.openMenu(x, y, await backgroundMenu())
  }

  async function backgroundMenu(): Promise<MenuItem[]> {
    return [
      { label: 'Edit Widgets', action: () => store.openGallery() },
      { separator: true },
      { label: 'New Folder', action: newFolder },
      { separator: true },
      {
        label: 'Sort Icons',
        children: [
          {
            label: 'By Name',
            checked: store.sortMode === 'name',
            action: () => store.sortIcons('name'),
          },
          {
            label: 'By Type',
            checked: store.sortMode === 'type',
            action: () => store.sortIcons('type'),
          },
        ],
      },
      { label: 'Clean Up Icons', action: () => store.cleanUpIcons() },
      { label: 'Select All', action: () => store.selectAll() },
      { separator: true },
      { label: 'Change Wallpaper', children: await wallpaperItems() },
      {
        label: 'Lock Desktop',
        checked: store.desktopLocked,
        action: () => store.setDesktopLocked(!store.desktopLocked),
      },
    ]
  }

  async function wallpaperItems(): Promise<MenuItem[]> {
    const reply = await bus.call('files:images', {}, CALL_TIMEOUT_MS)
    const images = imagesOf(reply)
    if (images.length === 0) {
      return [{ label: 'No images in the wallpaper folder', disabled: true }]
    }
    return images.map((image) => ({
      label: image.name,
      action: () => {
        void bus.call(
          'config:set',
          { key: 'appearance.wallpaper', value: image.path },
          CALL_TIMEOUT_MS,
        )
      },
    }))
  }

  function imagesOf(reply: unknown): WallpaperEntry[] {
    const entries = recordOf(reply).entries
    if (!Array.isArray(entries)) {
      return []
    }
    return entries as WallpaperEntry[]
  }

  function newFolder(): void {
    void bus.call('files:newfolder', {}, CALL_TIMEOUT_MS)
  }

  function showPreview(point: Point | null, box: Size, allowed: boolean): void {
    if (point === null) {
      preview = null
      return
    }
    preview = { point, box, allowed }
  }

  function previewClass(allowed: boolean): string {
    if (allowed) {
      return 'widget-preview free'
    }
    return 'widget-preview taken'
  }
</script>

<gtkoverlay class="desktop" hexpand vexpand>
  <!-- The background takes the rubber band and the menu. It is the overlay's
       main child, so it is measured and fills the surface; everything placed on
       top of it is an overlay child. -->
  <gtkpressable
    class="desktop-background"
    hexpand
    vexpand
    input
    onpress={handlePress}
    ondragstart={startBand}
    ondragmove={moveBand}
    ondragend={endBand}
  ></gtkpressable>

  {#if preview !== null}
    <gtkbox
      overlay
      class={previewClass(preview.allowed)}
      halign="start"
      valign="start"
      margin-start={preview.point.x}
      margin-top={preview.point.y}
      width={preview.box.width}
      height={preview.box.height}
    ></gtkbox>
  {/if}

  <DesktopIcons {bus} {store} />

  {#each store.widgetPlacements() as placement (placement.id)}
    <WidgetSlot {placement} {bus} {registry} {generation} {store} onpreview={showPreview} />
  {/each}

  {#if band !== null}
    <gtkbox
      overlay
      class="rubber-band"
      halign="start"
      valign="start"
      margin-start={band.x}
      margin-top={band.y}
      width={band.width}
      height={band.height}
    ></gtkbox>
  {/if}

  <AlignmentGuides guides={store.guides} />

  {#if store.menu !== null}
    <ContextMenu
      menu={store.menu}
      viewportWidth={store.viewportWidth}
      viewportHeight={store.viewportHeight}
      onclose={() => store.closeMenu()}
    />
  {/if}
</gtkoverlay>
