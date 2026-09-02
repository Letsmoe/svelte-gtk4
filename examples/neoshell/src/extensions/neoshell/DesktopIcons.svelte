<script lang="ts">
  import { subscribeTo } from '../../lib/bus'
  import { rectOf } from './freeform'
  import type { Point } from './freeform'
  import type { DesktopEntry, DesktopStore, MenuItem } from './desktopStore.svelte'
  import type { BusService } from '../../lib/bus'
  import { dragOf, pressOf, PRIMARY_BUTTON, SECONDARY_BUTTON } from './gestures'

  // The desktop folder's contents, placed free-form: an icon lands where it is
  // dropped and snaps to the screen edges and to whatever is already there.
  //
  // Each icon is an overlay child of the desktop pushed into place by margins,
  // and a drag is a Gtk.GestureDrag rather than captured pointer events — the
  // gesture already reports the delta the webview build had to compute from
  // clientX/clientY, and already decides when a press has become a drag.
  //
  // Icon art comes from the icon theme by freedesktop name; an image file shows
  // itself. The webview build routed both through the host over HTTP because a
  // page cannot read file://, which GTK simply does not need.

  const CALL_TIMEOUT_MS = 10000
  const DRAG_THRESHOLD_PX = 4
  const ICON_PIXELS = 48

  interface Drag {
    dx: number
    dy: number
    moved: boolean
    paths: string[]
    // The icon the pointer actually holds. It is the one that snaps; the rest
    // of the selection follows by the same delta so the shape is kept.
    leadPath: string
  }

  interface Handler {
    id: string
    name: string
    command: string
  }

  let { bus, store }: { bus: BusService; store: DesktopStore } = $props()

  let drag = $state<Drag | null>(null)
  let renameDraft = $state('')

  $effect(() =>
    subscribeTo(bus, 'files.desktop', (message) => {
      store.applyDesktopFolder(message.data)
    }),
  )

  function pointOf(entry: DesktopEntry): Point {
    const point = store.iconPoint(entry.path)
    if (point === undefined) {
      return { x: 0, y: 0 }
    }
    return point
  }

  // While a drag is live the icon is drawn at its point plus the settled delta;
  // committing the drag is what moves the point itself.
  function shownPointOf(entry: DesktopEntry): Point {
    const point = pointOf(entry)
    if (drag === null || !drag.moved || !drag.paths.includes(entry.path)) {
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
  // opens, secondary opens the menu. GTK reports all three through one gesture.
  function handlePress(entry: DesktopEntry, event: { detail: unknown }): void {
    const press = pressOf(event)
    if (press.button === SECONDARY_BUTTON) {
      void openMenu(entry, press.x, press.y)
      return
    }
    if (press.button !== PRIMARY_BUTTON) {
      return
    }
    if (press.count >= 2) {
      open(entry)
      return
    }
    selectFor(entry)
  }

  function selectFor(entry: DesktopEntry): void {
    if (!store.isSelected(entry.path)) {
      store.selectOnly(entry.path)
    }
  }

  function startDrag(entry: DesktopEntry): void {
    selectFor(entry)
    if (store.desktopLocked) {
      return
    }
    drag = { dx: 0, dy: 0, moved: false, paths: [...store.selection], leadPath: entry.path }
  }

  // The lead icon is snapped as the pointer moves, and the delta the snap
  // settled on is what the whole selection is drawn with — so what the guides
  // promise is what the drop commits.
  function moveDrag(event: { detail: unknown }): void {
    if (drag === null) {
      return
    }
    const loose = dragOf(event)
    const moved =
      drag.moved ||
      Math.abs(loose.dx) > DRAG_THRESHOLD_PX ||
      Math.abs(loose.dy) > DRAG_THRESHOLD_PX
    if (!moved) {
      drag = { ...drag, dx: loose.dx, dy: loose.dy, moved }
      return
    }
    const settled = snappedDelta(drag, { x: loose.dx, y: loose.dy })
    drag = { ...drag, dx: settled.x, dy: settled.y, moved }
  }

  function snappedDelta(current: Drag, loose: Point): Point {
    const lead = store.iconPoint(current.leadPath)
    if (lead === undefined) {
      return loose
    }
    const target = { x: lead.x + loose.x, y: lead.y + loose.y }
    const snapped = store.snapDrag(target, store.layout.iconSize, draggedRects(current))
    return { x: snapped.x - lead.x, y: snapped.y - lead.y }
  }

  function draggedRects(current: Drag) {
    return current.paths.flatMap((path) => {
      const point = store.iconPoint(path)
      if (point === undefined) {
        return []
      }
      return [rectOf(point, store.layout.iconSize)]
    })
  }

  function endDrag(): void {
    if (drag === null) {
      return
    }
    const finished = drag
    drag = null
    store.clearGuides()
    if (finished.moved) {
      commitDrag(finished)
    }
  }

  // A drag moves the whole selection by one delta, so the selection keeps its
  // shape.
  function commitDrag(finished: Drag): void {
    const targets = new Map<string, Point>()
    for (const path of finished.paths) {
      addTarget(targets, path, finished)
    }
    store.moveIcons(finished.paths, targets)
  }

  function addTarget(targets: Map<string, Point>, path: string, finished: Drag): void {
    const point = store.iconPoint(path)
    if (point === undefined) {
      return
    }
    targets.set(path, { x: point.x + finished.dx, y: point.y + finished.dy })
  }

  // The press coordinates are relative to the icon, and the menu is placed
  // against the desktop — so the icon's own point is added back.
  async function openMenu(entry: DesktopEntry, x: number, y: number): Promise<void> {
    selectFor(entry)
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
    ondragstart={() => startDrag(entry)}
    ondragmove={moveDrag}
    ondragend={endDrag}
  >
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
      <gtkicon
        class="desktop-icon-art"
        icon={entry.icon}
        size={ICON_PIXELS}
        halign="center"
      ></gtkicon>
    {/if}

    {#if store.renamingPath === entry.path}
      <gtkentry
        class="desktop-icon-rename"
        text={renameDraft}
        xalign={0.5}
        onchanged={(event) => (renameDraft = event.target.widget.get_text())}
        onactivate={() => commitRename(entry)}
      ></gtkentry>
    {:else}
      <gtklabel
        class="desktop-icon-label"
        wrap
        lines={2}
        ellipsize="end"
        justify="center"
      >
        {entry.name}
      </gtklabel>
    {/if}
  </gtkpressable>
{/each}
