<script lang="ts">
  import { rectOf } from './freeform'
  import type { Point } from './freeform'
  import type { DesktopEntry, DesktopStore, MenuItem } from './desktopStore.svelte'
  import type { BusLike } from './lib'

  // The desktop folder's contents, placed free-form: an icon lands where it is
  // dropped and snaps to the screen edges and to whatever is already there.
  // Entries and their icon names come from the files extension; the host
  // resolves both the freedesktop icon name and the image previews over HTTP.

  const CALL_TIMEOUT_MS = 10000
  const DRAG_THRESHOLD_PX = 4

  interface Drag {
    pointerId: number
    startX: number
    startY: number
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

  let { bus, store }: { bus: BusLike; store: DesktopStore } = $props()

  let brokenPaths: Set<string> = $state(new Set())
  let drag: Drag | null = $state(null)
  let renameDraft = $state('')

  $effect(() => {
    return bus.subscribe('files.desktop', (message) => {
      store.applyDesktopFolder(message.data)
      brokenPaths = new Set()
    })
  })

  // Image entries show themselves; everything else falls back to its icon
  // name, and to the generic file icon when the preview cannot be decoded.
  function sourceOf(entry: DesktopEntry): string {
    if (entry.image && !brokenPaths.has(entry.path)) {
      return `/file?path=${encodeURIComponent(entry.path)}`
    }
    return `/appicon/${encodeURIComponent(entry.icon)}?size=64`
  }

  function markBroken(entry: DesktopEntry): void {
    brokenPaths = new Set(brokenPaths).add(entry.path)
  }

  function pointOf(entry: DesktopEntry): Point {
    const point = store.iconPoint(entry.path)
    if (point === undefined) {
      return { x: 0, y: 0 }
    }
    return point
  }

  function shiftOf(path: string): string {
    if (drag === null || !drag.moved || !drag.paths.includes(path)) {
      return ''
    }
    return `translate(${drag.dx}px, ${drag.dy}px)`
  }

  function open(entry: DesktopEntry): void {
    void bus.call('files:open', { path: entry.path }, CALL_TIMEOUT_MS)
  }

  function openSelection(): void {
    for (const path of store.selection) {
      void bus.call('files:open', { path }, CALL_TIMEOUT_MS)
    }
  }

  function startDrag(entry: DesktopEntry, event: PointerEvent): void {
    if (event.button !== 0) {
      return
    }
    event.stopPropagation()
    if (event.ctrlKey) {
      store.toggleSelected(entry.path)
      return
    }
    if (!store.isSelected(entry.path)) {
      store.selectOnly(entry.path)
    }
    if (store.desktopLocked) {
      return
    }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dx: 0,
      dy: 0,
      moved: false,
      paths: [...store.selection],
      leadPath: entry.path,
    }
  }

  // The lead icon is snapped as the pointer moves, and the delta the snap
  // settled on is what the whole selection is drawn with — so what the guides
  // promise is what the drop commits.
  function moveDrag(event: PointerEvent): void {
    if (drag === null || drag.pointerId !== event.pointerId) {
      return
    }
    const loose = { x: event.clientX - drag.startX, y: event.clientY - drag.startY }
    const moved =
      drag.moved || Math.abs(loose.x) > DRAG_THRESHOLD_PX || Math.abs(loose.y) > DRAG_THRESHOLD_PX
    if (!moved) {
      drag = { ...drag, dx: loose.x, dy: loose.y, moved }
      return
    }
    const settled = snappedDelta(drag, loose)
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

  function endDrag(event: PointerEvent): void {
    if (drag === null || drag.pointerId !== event.pointerId) {
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

  async function openMenu(entry: DesktopEntry, event: MouseEvent): Promise<void> {
    event.preventDefault()
    event.stopPropagation()
    if (!store.isSelected(entry.path)) {
      store.selectOnly(entry.path)
    }
    store.openMenu(event.clientX, event.clientY, await iconMenu(entry))
  }

  async function iconMenu(entry: DesktopEntry): Promise<MenuItem[]> {
    const count = store.selection.size
    return [
      { label: count > 1 ? `Open ${count} items` : 'Open', action: openSelection },
      { label: 'Open With', children: await handlerItems(entry) },
      { separator: true },
      { label: 'Rename', disabled: count > 1, action: () => beginRename(entry) },
      {
        label: count > 1 ? `Move ${count} items to Trash` : 'Move to Trash',
        danger: true,
        action: trashSelection,
      },
    ]
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

  function focusInput(node: HTMLInputElement): void {
    node.focus()
    node.select()
  }

  // Tailwind's opacity slash is not a legal class: directive name, so the
  // selected tint is applied as a plain class string.
  function selectionClass(path: string): string {
    if (store.isSelected(path)) {
      return 'bg-base-content/20 ring-1 ring-base-content/25'
    }
    return 'hover:bg-base-content/10'
  }
</script>

{#each store.sortedEntries as entry (entry.path)}
  {@const point = pointOf(entry)}
  <button
    class="absolute flex flex-col items-center gap-1 rounded-lg p-2 text-center select-none
      focus:outline-none {selectionClass(entry.path)}"
    class:z-10={drag !== null && drag.paths.includes(entry.path)}
    style:left={`${point.x}px`}
    style:top={`${point.y}px`}
    style:width={`${store.layout.iconSize.width}px`}
    style:height={`${store.layout.iconSize.height}px`}
    style:transform={shiftOf(entry.path)}
    title={entry.name}
    ondblclick={() => open(entry)}
    onpointerdown={(event) => startDrag(entry, event)}
    onpointermove={moveDrag}
    onpointerup={endDrag}
    onpointercancel={endDrag}
    oncontextmenu={(event) => void openMenu(entry, event)}
  >
    <img
      class="h-12 w-12 shrink-0 object-contain drop-shadow-md"
      src={sourceOf(entry)}
      alt=""
      draggable="false"
      onerror={() => markBroken(entry)}
    />
    {#if store.renamingPath === entry.path}
      <input
        class="w-full rounded bg-base-100 px-1 text-center text-[11px] leading-tight
          text-base-content outline-none"
        bind:value={renameDraft}
        use:focusInput
        onpointerdown={(event) => event.stopPropagation()}
        onblur={() => commitRename(entry)}
        onkeydown={(event) => {
          if (event.key === 'Enter') {
            commitRename(entry)
          }
          if (event.key === 'Escape') {
            store.renamingPath = ''
          }
        }}
      />
    {:else}
      <span class="line-clamp-2 text-[11px] leading-tight text-base-content drop-shadow-md">
        {entry.name}
      </span>
    {/if}
  </button>
{/each}
