import { clampPoint, overlapsAny, rectOf, sizePx, snapPoint, spanOf, unitOf } from './freeform'
import type { Guide, Point, Rect, Size, Snapped, Viewport } from './freeform'
import {
  distinct,
  entriesOf,
  instancesOf,
  nextWidgetId,
  occupiedRects,
  resolveLayout,
  resolvedIconPoints,
  samePoints,
  seedsOf,
  sorted,
  storedPointsOf,
  storesPoint,
} from './desktopLayout'
import type { DesktopEntry, Layout, WidgetPlacement, WidgetSeed } from './desktopLayout'
import { recordOf } from './lib'
import type { BusLike } from './lib'

// DesktopStore is the desktop's reactive state: the folder's entries, what is
// selected, which widgets exist, the open context menu, and the config writes
// that persist any of it. Where things actually sit is decided by
// desktopLayout, which both the icons and the widget canvas resolve against —
// one desktop, one answer.
//
// Placement is free-form. Config holds pixel points, and a drag snaps to the
// screen edges and to whatever is already placed rather than to a lattice.
//
// Config is also the record of which widgets exist: widgets.<id> carries the
// type, so the gallery can add one and the context menu can remove it. The
// view tree's seed only applies to a desktop that has never been arranged.
//
// Writes are debounced because a resolve settles in several steps (the folder
// arrives, then the config), and only the settled answer is worth storing.

export interface MenuItem {
  label?: string
  separator?: boolean
  checked?: boolean
  danger?: boolean
  disabled?: boolean
  action?: () => void
  children?: MenuItem[]
}

export interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

export type { DesktopEntry, WidgetPlacement }

const CALL_TIMEOUT_MS = 10000
const PERSIST_DEBOUNCE_MS = 250

export class DesktopStore {
  entries = $state<DesktopEntry[]>([])
  desktopDir = $state('')
  selection = $state<ReadonlySet<string>>(new Set())
  menu = $state<MenuState | null>(null)
  renamingPath = $state('')
  viewportWidth = $state(1920)
  viewportHeight = $state(1080)
  desktopLocked = $state(false)
  sortMode = $state('name')
  guides = $state<Guide[]>([])

  private storedIcons = $state<Record<string, Point>>({})
  private storedWidgets = $state<Record<string, Record<string, unknown>> | null>(null)
  private seeds = $state<WidgetSeed[]>([])
  private folderLoaded = $state(false)
  private readonly listeners = new Set<() => void>()
  private readonly bus: BusLike
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  constructor(bus: BusLike) {
    this.bus = bus
  }

  // The unit sizes widgets and icons; nothing is positioned against it.
  readonly unit: number = $derived(unitOf(this.viewportWidth))

  readonly viewport: Viewport = $derived({
    width: this.viewportWidth,
    height: this.viewportHeight,
  })

  // The files extension already returns folders first and then names; a sort
  // mode reorders that, and because icons flow in this order it is also the
  // order a clean-up lays them out in.
  readonly sortedEntries: DesktopEntry[] = $derived(sorted(this.entries, this.sortMode))

  readonly layout: Layout = $derived(
    resolveLayout({
      entries: this.sortedEntries,
      storedIcons: this.storedIcons,
      instances: instancesOf(this.storedWidgets, this.seeds, this.unit),
      viewport: this.viewport,
    }),
  )

  // onChange lets the widget canvas — plain DOM, outside Svelte's reactivity —
  // reconcile its instances whenever the layout changes.
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  setViewport(width: number, height: number): void {
    this.viewportWidth = width
    this.viewportHeight = height
    this.notify()
  }

  // The seed is the desktop node's args, so it arrives with the view rather
  // than over the bus.
  setSeeds(value: unknown): void {
    this.seeds = seedsOf(value)
    this.notify()
  }

  applyDesktopFolder(data: unknown): void {
    const record = recordOf(data)
    if (typeof record.path === 'string') {
      this.desktopDir = record.path
    }
    this.entries = entriesOf(record.entries)
    this.folderLoaded = true
    this.pruneSelection()
  }

  applyConfig(snapshot: unknown): void {
    const root = recordOf(snapshot)
    const desktop = recordOf(root.desktop)
    this.storedIcons = storedPointsOf(root.icons, this.unit)
    this.storedWidgets = storedWidgetsOf(root.widgets)
    this.desktopLocked = desktop.locked === true
    this.sortMode = sortModeOf(desktop.sort)
    this.notify()
  }

  widgetPlacement(id: string): WidgetPlacement | undefined {
    return this.layout.widgets.get(id)
  }

  widgetPlacements(): WidgetPlacement[] {
    return [...this.layout.widgets.values()]
  }

  iconPoint(path: string): Point | undefined {
    return this.layout.icons.get(path)
  }

  isSelected(path: string): boolean {
    return this.selection.has(path)
  }

  // Selection follows the usual desktop chords: a plain click replaces it,
  // ctrl toggles one entry, and a rubber band replaces it with what it caught.
  selectOnly(path: string): void {
    this.selection = new Set([path])
  }

  toggleSelected(path: string): void {
    const next = new Set(this.selection)
    if (!next.delete(path)) {
      next.add(path)
    }
    this.selection = next
  }

  selectPaths(paths: Iterable<string>): void {
    this.selection = new Set(paths)
  }

  clearSelection(): void {
    this.selection = new Set()
  }

  selectAll(): void {
    this.selection = new Set(this.entries.map((entry) => entry.path))
  }

  openMenu(x: number, y: number, items: MenuItem[]): void {
    this.menu = { x, y, items }
  }

  closeMenu(): void {
    this.menu = null
  }

  openGallery(): void {
    this.bus.publish('widgets:gallery', { open: true })
  }

  // snapDrag is the live half of a drag: it reports where the item would land
  // and the lines that explain why, without committing anything.
  snapDrag(point: Point, size: Size, exclude: Rect[]): Point {
    const snapped = this.snapped(point, size, exclude)
    this.guides = snapped.guides
    return clampPoint(snapped.point, size, this.viewport)
  }

  // A widget drag draws the box it would land in, which says everything the
  // lines would have said.
  snapWithoutGuides(point: Point, size: Size, exclude: Rect[]): Point {
    const snapped = this.snapped(point, size, exclude)
    return clampPoint(snapped.point, size, this.viewport)
  }

  private snapped(point: Point, size: Size, exclude: Rect[]): Snapped {
    return snapPoint(point, size, this.othersFor(exclude), this.viewport)
  }

  clearGuides(): void {
    this.guides = []
  }

  private othersFor(exclude: Rect[]): Rect[] {
    const all = occupiedRects(this.layout, new Set(), new Set())
    return all.filter((rect) => !exclude.some((skip) => sameRect(rect, skip)))
  }

  // moveIcons shifts every dragged path to its target, and refuses the whole
  // move if any of them would land on something taken — a partial move would
  // silently scatter a multi-selection.
  moveIcons(paths: string[], targets: Map<string, Point>): boolean {
    const blocked = occupiedRects(this.layout, new Set(paths), new Set())
    if (!distinct(targets.values(), this.layout.iconSize)) {
      return false
    }
    for (const point of targets.values()) {
      if (overlapsAny(rectOf(point, this.layout.iconSize), blocked)) {
        return false
      }
    }
    const next = { ...this.storedIcons }
    for (const [path, point] of targets) {
      next[path] = point
    }
    this.storedIcons = next
    this.writeIcons(next)
    return true
  }

  // The drag preview asks the same question the drop does, so the outline never
  // promises a landing that would be refused.
  widgetDropAllowed(id: string, point: Point): boolean {
    const placement = this.layout.widgets.get(id)
    if (placement === undefined) {
      return false
    }
    const blocked = occupiedRects(this.layout, new Set(), new Set([id]))
    return !overlapsAny(rectOf(point, placement.box), blocked)
  }

  moveWidget(id: string, point: Point): boolean {
    if (!this.widgetDropAllowed(id, point)) {
      return false
    }
    this.patchWidget(id, { x: Math.round(point.x), y: Math.round(point.y) })
    return true
  }

  setWidgetLocked(id: string, locked: boolean): void {
    this.patchWidget(id, { locked })
  }

  // A resized widget drops its stored point when it no longer fits where it
  // was: the layout then places it rather than leaving it overlapping.
  setWidgetSize(id: string, size: string): void {
    this.patchWidget(id, { size, ...pointAfterResize(this, id, size) })
  }

  // A widget dragged out of the gallery carries the point it was dropped on;
  // one added without one is placed by the layout.
  addWidget(type: string, size: string, point?: Point): string {
    const current = this.instanceRecords()
    const id = nextWidgetId(type, new Set(Object.keys(current)))
    const next = { ...current, [id]: { type, size, locked: false, ...pointRecord(point) } }
    this.writeWidgets(next)
    return id
  }

  // Removing a widget deletes its entry outright. Config is the record of what
  // exists, so there is nothing left to hide it from.
  removeWidget(id: string): void {
    const next = { ...this.instanceRecords() }
    delete next[id]
    this.writeWidgets(next)
  }

  setDesktopLocked(locked: boolean): void {
    this.desktopLocked = locked
    void this.bus.call('config:set', { key: 'desktop.locked', value: locked }, CALL_TIMEOUT_MS)
  }

  // A widget is always draggable; locking one, or the desktop, is the only way
  // to pin it. Nothing is lost to a stray press — a drag has to travel before
  // it is one, and until then the press belongs to the widget.
  widgetDraggable(id: string): boolean {
    const placement = this.layout.widgets.get(id)
    if (placement === undefined) {
      return false
    }
    return !this.desktopLocked && !placement.locked
  }

  // Sorting and cleaning up both drop every stored point: the next resolve then
  // flows the whole folder back into reading order.
  sortIcons(mode: string): void {
    this.sortMode = mode
    void this.bus.call('config:set', { key: 'desktop.sort', value: mode }, CALL_TIMEOUT_MS)
    this.cleanUpIcons()
  }

  cleanUpIcons(): void {
    this.storedIcons = {}
    this.writeIcons({})
  }

  // schedulePersist takes the layout as an argument so the caller's effect
  // tracks it; the write itself runs off the effect, after the resolve has
  // stopped moving.
  schedulePersist(layout: Layout): void {
    this.cancelPersist()
    if (!this.folderLoaded) {
      return
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.persist(layout)
    }, PERSIST_DEBOUNCE_MS)
  }

  cancelPersist(): void {
    if (this.persistTimer === null) {
      return
    }
    clearTimeout(this.persistTimer)
    this.persistTimer = null
  }

  // instanceRecords is config's widget map, or the resolved seed the first time
  // anything writes to it — materialising the seed is what hands ownership of
  // the list from the view tree to config.
  private instanceRecords(): Record<string, Record<string, unknown>> {
    if (this.storedWidgets !== null) {
      return this.storedWidgets
    }
    const records: Record<string, Record<string, unknown>> = {}
    for (const placement of this.layout.widgets.values()) {
      records[placement.id] = recordFor(placement)
    }
    return records
  }

  private persist(layout: Layout): void {
    this.persistIcons(layout)
    this.persistWidgets(layout)
  }

  private persistIcons(layout: Layout): void {
    const points = resolvedIconPoints(layout)
    if (samePoints(points, this.storedIcons)) {
      return
    }
    this.storedIcons = points
    this.writeIcons(points)
  }

  // The resolved point is written back so a widget the desktop placed itself —
  // seeded, or displaced off a stale point — survives a restart the same way a
  // dragged one does.
  private persistWidgets(layout: Layout): void {
    const stored = this.storedWidgets
    if (stored === null) {
      this.writeWidgets(this.instanceRecords())
      return
    }
    const next = { ...stored }
    let changed = false
    for (const [id, placement] of layout.widgets) {
      changed = stageWidgetPoint(next, id, placement) || changed
    }
    if (changed) {
      this.writeWidgets(next)
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  private patchWidget(id: string, patch: Record<string, unknown>): void {
    const current = this.instanceRecords()
    const merged = { ...current[id], ...patch }
    this.writeWidgets({ ...current, [id]: merged })
  }

  private writeWidgets(next: Record<string, Record<string, unknown>>): void {
    this.storedWidgets = next
    void this.bus.call('config:set', { key: 'widgets', value: next }, CALL_TIMEOUT_MS)
    this.notify()
  }

  // Points are written as whole maps: config:set addresses keys by dot-path,
  // and a file path as a key would explode into one nested object per segment.
  private writeIcons(points: Record<string, Point>): void {
    void this.bus.call('config:set', { key: 'icons', value: points }, CALL_TIMEOUT_MS)
    this.notify()
  }

  private pruneSelection(): void {
    const live = new Set(this.entries.map((entry) => entry.path))
    const next = new Set([...this.selection].filter((path) => live.has(path)))
    if (next.size !== this.selection.size) {
      this.selection = next
    }
  }
}

function pointRecord(point: Point | undefined): Record<string, unknown> {
  if (point === undefined) {
    return {}
  }
  return { x: Math.round(point.x), y: Math.round(point.y) }
}

function recordFor(placement: WidgetPlacement): Record<string, unknown> {
  return {
    type: placement.type,
    size: placement.size,
    locked: placement.locked,
    x: Math.round(placement.point.x),
    y: Math.round(placement.point.y),
  }
}

// The resolved type is written back alongside the point so an entry that
// predates config carrying one stops depending on the seed to name it: the
// migration finishes on disk rather than being redone on every read.
function stageWidgetPoint(
  next: Record<string, Record<string, unknown>>,
  id: string,
  placement: WidgetPlacement,
): boolean {
  const stored = next[id]
  if (storesPoint(stored, placement.point) && stored?.type === placement.type) {
    return false
  }
  next[id] = {
    ...stored,
    type: placement.type,
    x: Math.round(placement.point.x),
    y: Math.round(placement.point.y),
  }
  return true
}

// A widget growing into space something else holds keeps its point only if the
// larger box still fits; otherwise the point is dropped and the layout places
// it afresh.
function pointAfterResize(store: DesktopStore, id: string, size: string): Record<string, unknown> {
  const placement = store.widgetPlacement(id)
  if (placement === undefined) {
    return {}
  }
  const box = sizePx(store.unit, spanOf(size))
  const blocked = occupiedRects(store.layout, new Set(), new Set([id]))
  const grown = clampPoint(placement.point, box, store.viewport)
  if (!overlapsAny(rectOf(grown, box), blocked)) {
    return { x: Math.round(grown.x), y: Math.round(grown.y) }
  }
  return { x: undefined, y: undefined }
}

function sameRect(left: Rect, right: Rect): boolean {
  if (left.x !== right.x || left.y !== right.y) {
    return false
  }
  return left.width === right.width && left.height === right.height
}

function storedWidgetsOf(value: unknown): Record<string, Record<string, unknown>> | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const widgets: Record<string, Record<string, unknown>> = {}
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    widgets[id] = recordOf(raw)
  }
  return widgets
}

function sortModeOf(value: unknown): string {
  if (value === 'type') {
    return 'type'
  }
  return 'name'
}
