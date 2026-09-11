<script lang="ts">
  import { subscribeTo } from '../../lib/bus'
  import { rectOf } from './freeform'
  import type { Point, Rect } from './freeform'
  import type { DesktopEntry, DesktopStore, MenuItem } from './desktopStore.svelte'
  import type { BusService } from '../../lib/bus'
  import { glide } from './glide'
  import type { GlideStop } from './glide'
  import {
    dragOf,
    extendsSelection,
    pressOf,
    PRIMARY_BUTTON,
    SECONDARY_BUTTON,
  } from './gestures'

  // The desktop folder's contents, placed free-form. A drag behaves the way a
  // Finder desktop does: the selection is picked up as translucent copies that
  // follow the pointer exactly, the originals stay where they are, and only the
  // drop is snapped — to the screen edges and to whatever is already there —
  // with the icons gliding from where they were let go to where they settle.
  //
  // Each icon is an overlay child of the desktop pushed into place by margins,
  // and a drag is a Gtk.GestureDrag rather than captured pointer events.
  //
  // Icon art comes from the icon theme by freedesktop name; an image file shows
  // itself.

  const CALL_TIMEOUT_MS = 10000
  const DRAG_THRESHOLD_PX = 4
  const ICON_PIXELS = 48

  interface Drag {
    dx: number
    dy: number
    moved: boolean
    paths: string[]
    // The icon the pointer actually holds. It is the one whose landing is
    // snapped; the rest of the selection follows by the same delta so the
    // shape is kept.
    leadPath: string
  }

  // The moved icons, drawn offset from their new points while they glide in.
  interface Settle {
    paths: Set<string>
    offset: Point
  }

  interface Handler {
    id: string
    name: string
    command: string
  }

  let { bus, store }: { bus: BusService; store: DesktopStore } = $props()

  let drag = $state<Drag | null>(null)
  let settle = $state<Settle | null>(null)
  let renameDraft = $state('')
  // Whether the most recent drag travelled. The release that ends it arrives
  // as a press too, and a press after a move must not reselect.
  let lastDragMoved = false
  let stopSettle: GlideStop = () => {}

  $effect(() =>
    subscribeTo(bus, 'files.desktop', (message) => {
      store.applyDesktopFolder(message.data)
    }),
  )

  const ghosts = $derived(ghostEntries(drag))

  function ghostEntries(current: Drag | null): DesktopEntry[] {
    if (current === null || !current.moved) {
      return []
    }
    return store.sortedEntries.filter((entry) => current.paths.includes(entry.path))
  }

  function pointOf(entry: DesktopEntry): Point {
    const point = store.iconPoint(entry.path)
    if (point === undefined) {
      return { x: 0, y: 0 }
    }
    return point
  }

  // An icon that has just been dropped is drawn short of its point until the
  // glide has carried it there.
  function shownPointOf(entry: DesktopEntry): Point {
    const point = pointOf(entry)
    if (settle === null || !settle.paths.has(entry.path)) {
      return point
    }
    return { x: point.x + settle.offset.x, y: point.y + settle.offset.y }
  }

  function ghostPointOf(entry: DesktopEntry): Point {
    const point = pointOf(entry)
    if (drag === null) {
      return point
    }
    return { x: point.x + drag.dx, y: point.y + drag.dy }
  }

  function open(entry: DesktopEntry): void {
    void bus.call('files:open', { path: entry.path }, CALL_TIMEOUT_MS)
  }

  function openSelection(): void {
    for (const path of store.selection) {
      void bus.call('files:open', { path }, CALL_TIMEOUT_MS)
    }
  }

  // A press is the whole click vocabulary: primary selects, primary twice
  // opens, ctrl-primary toggles, secondary opens the menu. GTK reports them
  // all through one gesture, on release.
  function handlePress(entry: DesktopEntry, event: { detail: unknown }): void {
    const press = pressOf(event)
    if (press.button === SECONDARY_BUTTON) {
      void openMenu(entry, press.x, press.y)
      return
    }
    if (press.button !== PRIMARY_BUTTON || dragMoved()) {
      return
    }
    if (press.count >= 2) {
      open(entry)
      return
    }
    if (extendsSelection(press)) {
      store.toggleSelected(entry.path)
      return
    }
    // A plain click on one of several selected icons narrows the selection
    // to it — on release, so the press could still have dragged them all.
    store.selectOnly(entry.path)
  }

  function dragMoved(): boolean {
    if (drag !== null) {
      return drag.moved
    }
    return lastDragMoved
  }

  // The press picks the icon up: an unselected one becomes the selection, a
  // selected one keeps the selection it is part of so the drag moves it all.
  function startDrag(entry: DesktopEntry, event: { detail: unknown }): void {
    lastDragMoved = false
    if (!store.isSelected(entry.path)) {
      pickUp(entry, extendsSelection(dragOf(event)))
    }
    if (store.desktopLocked) {
      return
    }
    finishSettle()
    drag = { dx: 0, dy: 0, moved: false, paths: [...store.selection], leadPath: entry.path }
  }

  function pickUp(entry: DesktopEntry, extend: boolean): void {
    if (extend) {
      store.toggleSelected(entry.path)
      return
    }
    store.selectOnly(entry.path)
  }

  function moveDrag(event: { detail: unknown }): void {
    if (drag === null) {
      return
    }
    const loose = dragOf(event)
    const moved =
      drag.moved ||
      Math.abs(loose.dx) > DRAG_THRESHOLD_PX ||
      Math.abs(loose.dy) > DRAG_THRESHOLD_PX
    drag = { ...drag, dx: loose.dx, dy: loose.dy, moved }
  }

  function endDrag(event: { target: { widget: unknown } }): void {
    if (drag === null) {
      return
    }
    const finished = drag
    drag = null
    lastDragMoved = finished.moved
    if (finished.moved) {
      dropDrag(finished, event.target.widget as Parameters<typeof glide>[0])
    }
  }

  // The lead icon's landing is snapped, and the delta that snap settled on is
  // what the whole selection moves by, so the selection keeps its shape. A
  // landing on something taken is refused and the originals never moved.
  function dropDrag(finished: Drag, widget: Parameters<typeof glide>[0]): void {
    const loose = { x: finished.dx, y: finished.dy }
    const delta = settledDelta(finished, loose)
    const targets = new Map<string, Point>()
    for (const path of finished.paths) {
      addTarget(targets, path, delta)
    }
    if (!store.moveIcons(finished.paths, targets)) {
      return
    }
    startSettle(finished.paths, { x: loose.x - delta.x, y: loose.y - delta.y }, widget)
  }

  function settledDelta(finished: Drag, loose: Point): Point {
    const lead = store.iconPoint(finished.leadPath)
    if (lead === undefined) {
      return loose
    }
    const target = { x: lead.x + loose.x, y: lead.y + loose.y }
    const landing = store.landingFor(target, store.layout.iconSize, draggedRects(finished))
    return { x: landing.x - lead.x, y: landing.y - lead.y }
  }

  function draggedRects(finished: Drag): Rect[] {
    return finished.paths.flatMap((path) => {
      const point = store.iconPoint(path)
      if (point === undefined) {
        return []
      }
      return [rectOf(point, store.layout.iconSize)]
    })
  }

  function addTarget(targets: Map<string, Point>, path: string, delta: Point): void {
    const point = store.iconPoint(path)
    if (point === undefined) {
      return
    }
    targets.set(path, { x: point.x + delta.x, y: point.y + delta.y })
  }

  // The icons appear at their new points offset back to where the pointer let
  // them go, then glide the rest of the way.
  function startSettle(paths: string[], from: Point, widget: Parameters<typeof glide>[0]): void {
    finishSettle()
    settle = { paths: new Set(paths), offset: from }
    stopSettle = glide(
      widget,
      from,
      { x: 0, y: 0 },
      (offset) => {
        settle = { paths: new Set(paths), offset }
      },
      finishSettle,
    )
  }

  function finishSettle(): void {
    stopSettle()
    stopSettle = () => {}
    settle = null
  }

  // The press coordinates are relative to the icon, and the menu is placed
  // against the desktop — so the icon's own point is added back.
  async function openMenu(entry: DesktopEntry, x: number, y: number): Promise<void> {
    if (!store.isSelected(entry.path)) {
      store.selectOnly(entry.path)
    }
    const point = pointOf(entry)
    store.openMenu(point.x + x, point.y + y, await iconMenu(entry))
  }

  async function iconMenu(entry: DesktopEntry): Promise<MenuItem[]> {
    const count = store.selection.size
    return [
      { label: openLabel(count), action: openSelection },
      { label: 'Open With', children: await handlerItems(entry) },
      { separator: true },
      { label: 'Rename', disabled: count > 1, action: () => beginRename(entry) },
      { label: trashLabel(count), danger: true, action: trashSelection },
    ]
  }

  function openLabel(count: number): string {
    if (count > 1) {
      return `Open ${count} items`
    }
    return 'Open'
  }

  function trashLabel(count: number): string {
    if (count > 1) {
      return `Move ${count} items to Trash`
    }
    return 'Move to Trash'
  }

  async function handlerItems(entry: DesktopEntry): Promise<MenuItem[]> {
    const reply = await bus.call('files:handlers', { path: entry.path }, CALL_TIMEOUT_MS)
    const handlers = handlersOf(reply)
    if (handlers.length === 0) {
      return [{ label: 'No applications found', disabled: true }]
    }
    return handlers.map((handler) => ({
      label: handler.name,
      action: () => {
        void bus.call(
          'files:openwith',
          { path: entry.path, command: handler.command },
          CALL_TIMEOUT_MS,
        )
      },
    }))
  }

  function handlersOf(reply: unknown): Handler[] {
    if (typeof reply !== 'object' || reply === null) {
      return []
    }
    const handlers = (reply as { handlers?: unknown }).handlers
    if (!Array.isArray(handlers)) {
      return []
    }
    return handlers as Handler[]
  }

  function beginRename(entry: DesktopEntry): void {
    renameDraft = entry.name
    store.renamingPath = entry.path
  }

  function commitRename(entry: DesktopEntry): void {
    const name = renameDraft.trim()
    store.renamingPath = ''
    if (name === '' || name === entry.name) {
      return
    }
    void bus.call('files:rename', { path: entry.path, name }, CALL_TIMEOUT_MS)
  }

  function trashSelection(): void {
    void bus.call('files:trash', { paths: [...store.selection] }, CALL_TIMEOUT_MS)
    store.clearSelection()
  }

  function tileClass(path: string): string {
    if (store.isSelected(path)) {
      return 'desktop-icon selected'
    }
    return 'desktop-icon'
  }
</script>

{#snippet art(entry: DesktopEntry)}
  {#if entry.image}
    <gtkpicture
      class="desktop-icon-art"
      file={entry.path}
      fit="contain"
      width={ICON_PIXELS}
      height={ICON_PIXELS}
      halign="center"
    ></gtkpicture>
  {:else}
    <gtkicon class="desktop-icon-art" icon={entry.icon} size={ICON_PIXELS} halign="center"></gtkicon>
  {/if}
{/snippet}

{#snippet caption(entry: DesktopEntry)}
  <gtklabel class="desktop-icon-label" wrap lines={2} ellipsize="end" justify="center">
    {entry.name}
  </gtklabel>
{/snippet}

{#each store.sortedEntries as entry (entry.path)}
  {@const point = shownPointOf(entry)}
  <gtkpressable
    overlay
    class={tileClass(entry.path)}
    orientation="vertical"
    spacing={4}
    halign="start"
    valign="start"
    margin-start={point.x}
    margin-top={point.y}
    width={store.layout.iconSize.width}
    height={store.layout.iconSize.height}
    tooltip={entry.name}
    onpress={(event) => handlePress(entry, event)}
    ondragstart={(event) => startDrag(entry, event)}
    ondragmove={moveDrag}
    ondragend={endDrag}
  >
    {@render art(entry)}

    {#if store.renamingPath === entry.path}
      <gtkentry
        class="desktop-icon-rename"
        text={renameDraft}
        xalign={0.5}
        onchanged={(event) => (renameDraft = event.target.widget.get_text())}
        onactivate={() => commitRename(entry)}
      ></gtkentry>
    {:else}
      {@render caption(entry)}
    {/if}
  </gtkpressable>
{/each}

<!-- The copies the pointer carries. The press keeps an implicit grab on the
     original tile, so these never take an event of their own. -->
{#each ghosts as entry (entry.path)}
  {@const point = ghostPointOf(entry)}
  <gtkbox
    overlay
    class="desktop-icon ghost"
    orientation="vertical"
    spacing={4}
    halign="start"
    valign="start"
    margin-start={point.x}
    margin-top={point.y}
    width={store.layout.iconSize.width}
    height={store.layout.iconSize.height}
  >
    {@render art(entry)}
    {@render caption(entry)}
  </gtkbox>
{/each}
