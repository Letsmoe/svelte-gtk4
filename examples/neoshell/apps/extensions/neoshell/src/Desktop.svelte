<script lang="ts">
  import AlignmentGuides from './AlignmentGuides.svelte'
  import ContextMenu from './ContextMenu.svelte'
  import DesktopIcons from './DesktopIcons.svelte'
  import Wallpaper from './Wallpaper.svelte'
  import type { DesktopStore, MenuItem } from './desktopStore.svelte'
  import { recordOf } from './lib'
  import type { BusLike } from './lib'

  // The desktop: the background-layer view that owns everything behind the
  // windows — the wallpaper, the desktop folder's icons, and the widget grid.
  // Widgets are this node's children in the view tree; the canvas they render
  // into is a sibling element the view factory attaches over this one, since
  // it owns their placement and dragging.
  //
  // Icons and widgets share one grid, so this node also owns what spans both:
  // the rubber band that selects icons, the background context menu, and the
  // keyboard shortcuts that act on a selection.

  const CALL_TIMEOUT_MS = 10000

  interface Band {
    pointerId: number
    startX: number
    startY: number
    x: number
    y: number
  }

  interface WallpaperEntry {
    name: string
    path: string
  }

  let { bus, store }: { bus: BusLike; store: DesktopStore } = $props()

  let band: Band | null = $state(null)

  let bandRect = $derived(rectOf(band))

  $effect(() => {
    const onResize = () => {
      store.setViewport(window.innerWidth, window.innerHeight)
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  })

  // Config is the desktop's state file, not just its seed: whatever the
  // resolved layout ends up being — icons the folder flowed into place, a
  // widget displaced off a stale cell — is written back once it settles.
  $effect(() => {
    store.schedulePersist(store.layout)
    return () => store.cancelPersist()
  })

  function rectOf(current: Band | null) {
    if (current === null) {
      return null
    }
    return {
      left: Math.min(current.startX, current.x),
      top: Math.min(current.startY, current.y),
      width: Math.abs(current.x - current.startX),
      height: Math.abs(current.y - current.startY),
    }
  }

  function startBand(event: PointerEvent): void {
    if (event.button !== 0) {
      return
    }
    store.clearSelection()
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    band = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
    }
  }

  function moveBand(event: PointerEvent): void {
    if (band === null || band.pointerId !== event.pointerId) {
      return
    }
    band = { ...band, x: event.clientX, y: event.clientY }
    store.selectPaths(pathsInBand())
  }

  function endBand(event: PointerEvent): void {
    if (band === null || band.pointerId !== event.pointerId) {
      return
    }
    band = null
  }

  // Icon cells are known geometry, so the band is intersected against computed
  // rects rather than against measured DOM nodes.
  function pathsInBand(): string[] {
    const rect = bandRect
    if (rect === null) {
      return []
    }
    const hit: string[] = []
    for (const [path, point] of store.layout.icons) {
      if (intersects(rect, point.x, point.y)) {
        hit.push(path)
      }
    }
    return hit
  }

  function intersects(
    rect: { left: number; top: number; width: number; height: number },
    left: number,
    top: number,
  ): boolean {
    const { width, height } = store.layout.iconSize
    if (left + width < rect.left || left > rect.left + rect.width) {
      return false
    }
    return !(top + height < rect.top || top > rect.top + rect.height)
  }

  async function openMenu(event: MouseEvent): Promise<void> {
    event.preventDefault()
    store.clearSelection()
    store.openMenu(event.clientX, event.clientY, await backgroundMenu())
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
          { label: 'By Name', checked: store.sortMode === 'name', action: () => store.sortIcons('name') },
          { label: 'By Type', checked: store.sortMode === 'type', action: () => store.sortIcons('type') },
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

  function handleKey(event: KeyboardEvent): void {
    if (store.renamingPath !== '') {
      return
    }
    if (event.key === 'Escape') {
      store.clearSelection()
    }
    if (event.key === 'a' && event.ctrlKey) {
      event.preventDefault()
      store.selectAll()
    }
    if (event.key === 'Delete' && store.selection.size > 0) {
      void bus.call('files:trash', { paths: [...store.selection] }, CALL_TIMEOUT_MS)
      store.clearSelection()
    }
  }
</script>

<svelte:window on:keydown={handleKey} />

<div
  class="fixed inset-0 overflow-hidden"
  role="presentation"
  onpointerdown={startBand}
  onpointermove={moveBand}
  onpointerup={endBand}
  onpointercancel={endBand}
  oncontextmenu={(event) => void openMenu(event)}
>
  <Wallpaper {bus} />
  <DesktopIcons {bus} {store} />

  {#if bandRect !== null}
    <div
      class="pointer-events-none absolute rounded-sm border border-primary/70 bg-primary/20"
      style:left={`${bandRect.left}px`}
      style:top={`${bandRect.top}px`}
      style:width={`${bandRect.width}px`}
      style:height={`${bandRect.height}px`}
    ></div>
  {/if}

  <AlignmentGuides guides={store.guides} />
</div>

{#if store.menu !== null}
  <ContextMenu menu={store.menu} onclose={() => store.closeMenu()} />
{/if}
