import {
  GAP_PX,
  ICON_SPAN,
  MARGIN_PX,
  TOP_PX,
  clampPoint,
  firstFreeSpot,
  overlapsAny,
  rectOf,
  sizePx,
  spanOf,
  unitOf,
} from './freeform'
import type { Point, Rect, Size, Viewport } from './freeform'
import { recordOf } from '../../lib/record.js'

// Where every icon and widget sits on the desktop. Placement is free-form —
// pixels, not cells — so this resolves overlap rather than cell occupancy:
// widgets claim their rects first, then icons take their stored spot when
// nothing covers it and flow into the first free one otherwise.
//
// Which widgets exist is config's answer, not the view tree's. The tree
// supplies a seed for a desktop that has never been arranged and nothing after
// that, so adding and removing widgets is something the user can do.
//
// Everything in this module is pure — the store holds the reactive state and
// the writes, and calls in here to decide what the desktop looks like.

export interface DesktopEntry {
  name: string
  path: string
  directory: boolean
  icon: string
  image: boolean
}

// WidgetSeed is one entry of the desktop node's args: what to put on a desktop
// that has never been arranged.
export interface WidgetSeed {
  id: string
  type: string
  size: string
}

export interface WidgetInstance {
  id: string
  type: string
  size: string
  point?: Point
  locked: boolean
}

export interface WidgetPlacement {
  id: string
  type: string
  size: string
  point: Point
  box: Size
  locked: boolean
}

export interface LayoutInput {
  entries: DesktopEntry[]
  storedIcons: Record<string, Point>
  instances: WidgetInstance[]
  viewport: Viewport
}

export interface Layout {
  icons: Map<string, Point>
  widgets: Map<string, WidgetPlacement>
  iconSize: Size
}

export function resolveLayout(input: LayoutInput): Layout {
  const unit = unitOf(input.viewport.width)
  const iconSize = sizePx(unit, ICON_SPAN)
  const taken: Rect[] = []
  const widgets = resolveWidgets(input, unit, taken)
  return { widgets, iconSize, icons: resolveIcons(input, iconSize, taken) }
}

// A widget with no stored point has just been added; it takes the first free
// spot from the right, away from the icons flowing up the left.
function resolveWidgets(
  input: LayoutInput,
  unit: number,
  taken: Rect[],
): Map<string, WidgetPlacement> {
  const placements = new Map<string, WidgetPlacement>()
  for (const instance of input.instances) {
    const placement = placeWidget(instance, unit, input.viewport, taken)
    taken.push(rectOf(placement.point, placement.box))
    placements.set(instance.id, placement)
  }
  return placements
}

function placeWidget(
  instance: WidgetInstance,
  unit: number,
  viewport: Viewport,
  taken: Rect[],
): WidgetPlacement {
  const size = sizePx(unit, spanOf(instance.size))
  return {
    id: instance.id,
    type: instance.type,
    size: instance.size,
    box: size,
    locked: instance.locked,
    point: settledPoint(instance.point, size, viewport, taken),
  }
}

// A stored point can predate a change to the output or to the widget's own
// size, so it is clamped back onto the desktop and moved off anything it now
// covers — two widgets sharing pixels is never the intended reading.
function settledPoint(
  stored: Point | undefined,
  size: Size,
  viewport: Viewport,
  taken: Rect[],
): Point {
  if (stored === undefined) {
    return firstFreeSpot(size, taken, viewport, true)
  }
  const clamped = clampPoint(stored, size, viewport)
  if (!overlapsAny(rectOf(clamped, size), taken)) {
    return clamped
  }
  return firstFreeSpot(size, taken, viewport, true)
}

// Icons resolve in the folder's own order, so the spot an unplaced entry flows
// into does not depend on which entry changed.
function resolveIcons(input: LayoutInput, iconSize: Size, taken: Rect[]): Map<string, Point> {
  const points = new Map<string, Point>()
  const unplaced: string[] = []
  for (const entry of input.entries) {
    claimStoredPoint(input, entry.path, iconSize, taken, points, unplaced)
  }
  for (const path of unplaced) {
    const point = firstFreeSpot(iconSize, taken, input.viewport, false)
    taken.push(rectOf(point, iconSize))
    points.set(path, point)
  }
  return points
}

function claimStoredPoint(
  input: LayoutInput,
  path: string,
  iconSize: Size,
  taken: Rect[],
  points: Map<string, Point>,
  unplaced: string[],
): void {
  const stored = input.storedIcons[path]
  if (stored === undefined) {
    unplaced.push(path)
    return
  }
  const clamped = clampPoint(stored, iconSize, input.viewport)
  if (overlapsAny(rectOf(clamped, iconSize), taken)) {
    unplaced.push(path)
    return
  }
  taken.push(rectOf(clamped, iconSize))
  points.set(path, clamped)
}

// occupiedRects is the collision map a drop is tested against, minus whatever
// is being dragged — an item never blocks its own move.
export function occupiedRects(
  layout: Layout,
  exceptPaths: ReadonlySet<string>,
  exceptWidgets: ReadonlySet<string>,
): Rect[] {
  const rects: Rect[] = []
  for (const [id, placement] of layout.widgets) {
    if (!exceptWidgets.has(id)) {
      rects.push(rectOf(placement.point, placement.box))
    }
  }
  for (const [path, point] of layout.icons) {
    if (!exceptPaths.has(path)) {
      rects.push(rectOf(point, layout.iconSize))
    }
  }
  return rects
}

export function distinct(points: Iterable<Point>, size: Size): boolean {
  const placed: Rect[] = []
  for (const point of points) {
    const rect = rectOf(point, size)
    if (overlapsAny(rect, placed)) {
      return false
    }
    placed.push(rect)
  }
  return true
}

// resolvedIconPoints is the layout as config stores it. Rebuilding the map from
// what the desktop currently shows is also what prunes entries whose file is
// gone.
export function resolvedIconPoints(layout: Layout): Record<string, Point> {
  const points: Record<string, Point> = {}
  for (const [path, point] of layout.icons) {
    points[path] = point
  }
  return points
}

export function samePoints(
  left: Record<string, Point>,
  right: Record<string, Point>,
): boolean {
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) {
    return false
  }
  return keys.every((key) => samePoint(left[key], right[key]))
}

function samePoint(left: Point, right: Point | undefined): boolean {
  if (right === undefined) {
    return false
  }
  return Math.round(left.x) === Math.round(right.x) && Math.round(left.y) === Math.round(right.y)
}

export function storesPoint(stored: Record<string, unknown> | undefined, point: Point): boolean {
  if (stored === undefined) {
    return false
  }
  return samePoint(point, pointOf(stored))
}

// sorted keeps folders ahead of files either way — a desktop that mixes them
// reads as unsorted whatever the key is.
export function sorted(entries: DesktopEntry[], mode: string): DesktopEntry[] {
  return [...entries].sort((left, right) => compareEntries(left, right, mode))
}

function compareEntries(left: DesktopEntry, right: DesktopEntry, mode: string): number {
  if (left.directory !== right.directory) {
    return foldersFirst(left)
  }
  if (mode === 'type') {
    const byType = typeKeyOf(left).localeCompare(typeKeyOf(right))
    if (byType !== 0) {
      return byType
    }
  }
  return left.name.toLowerCase().localeCompare(right.name.toLowerCase())
}

function foldersFirst(left: DesktopEntry): number {
  if (left.directory) {
    return -1
  }
  return 1
}

function typeKeyOf(entry: DesktopEntry): string {
  const dot = entry.name.lastIndexOf('.')
  if (dot <= 0) {
    return ''
  }
  return entry.name.slice(dot + 1).toLowerCase()
}

export function storedPointsOf(value: unknown, unit: number): Record<string, Point> {
  const points: Record<string, Point> = {}
  for (const [key, raw] of Object.entries(recordOf(value))) {
    addPoint(points, key, raw, unit)
  }
  return points
}

function addPoint(
  points: Record<string, Point>,
  key: string,
  raw: unknown,
  unit: number,
): void {
  const point = pointOf(recordOf(raw), unit)
  if (point === undefined) {
    return
  }
  points[key] = point
}

// A desktop arranged before placement went free-form stored cells. Reading one
// as its pixel origin is what carries an existing arrangement across, rather
// than dumping every icon back into a fresh flow.
export function pointOf(stored: Record<string, unknown>, unit = 0): Point | undefined {
  const { x, y, column, row } = stored
  if (typeof x === 'number' && typeof y === 'number') {
    return { x, y }
  }
  if (typeof column !== 'number' || typeof row !== 'number' || unit === 0) {
    return undefined
  }
  return { x: MARGIN_PX + column * (unit + GAP_PX), y: TOP_PX + row * (unit + GAP_PX) }
}

// Config is the record of which widgets exist. A desktop that has never been
// arranged has no entry at all, and takes the view tree's seed instead — an
// empty object is an emptied desktop and stays empty.
export function instancesOf(
  stored: unknown,
  seed: WidgetSeed[],
  unit: number,
): WidgetInstance[] {
  if (typeof stored !== 'object' || stored === null) {
    return seed.map((entry) => seededInstance(entry))
  }
  const seededTypes = new Map(seed.map((entry) => [entry.id, entry.type]))
  return Object.entries(recordOf(stored)).flatMap(([id, raw]) =>
    instanceOf(id, raw, unit, seededTypes),
  )
}

function seededInstance(seed: WidgetSeed): WidgetInstance {
  return { id: seed.id, type: seed.type, size: seed.size, locked: false }
}

function instanceOf(
  id: string,
  raw: unknown,
  unit: number,
  seededTypes: ReadonlyMap<string, string>,
): WidgetInstance[] {
  const stored = recordOf(raw)
  const type = typeOf(stored, id, seededTypes)
  if (type === '') {
    return []
  }
  return [
    {
      id,
      type,
      size: stringOr(stored.size, 'small'),
      point: pointOf(stored, unit),
      locked: stored.locked === true,
    },
  ]
}

// A desktop arranged before config carried the type has entries holding only a
// placement. The seed still knows what each of its own ids is, so those entries
// keep working; one naming an id the seed never had is not a widget.
function typeOf(
  stored: Record<string, unknown>,
  id: string,
  seededTypes: ReadonlyMap<string, string>,
): string {
  if (typeof stored.type === 'string' && stored.type !== '') {
    return stored.type
  }
  const seeded = seededTypes.get(id)
  if (seeded === undefined) {
    return ''
  }
  return seeded
}

export function entriesOf(value: unknown): DesktopEntry[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map(entryOf).filter((entry): entry is DesktopEntry => entry !== null)
}

function entryOf(raw: unknown): DesktopEntry | null {
  const record = recordOf(raw)
  const { name, path } = record
  if (typeof name !== 'string' || typeof path !== 'string') {
    return null
  }
  return {
    name,
    path,
    directory: record.directory === true,
    icon: stringOr(record.icon, 'text-x-generic'),
    image: record.image === true,
  }
}

export function seedsOf(value: unknown): WidgetSeed[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap(seedOf)
}

function seedOf(raw: unknown): WidgetSeed[] {
  const record = recordOf(raw)
  const { id, type } = record
  if (typeof id !== 'string' || id === '' || typeof type !== 'string' || type === '') {
    return []
  }
  return [{ id, type, size: stringOr(record.size, 'small') }]
}

// nextWidgetId names a widget added from the gallery after its type, so a
// config file stays readable: weather, then weather-2.
export function nextWidgetId(type: string, taken: ReadonlySet<string>): string {
  const base = type.split('.')[0]
  if (!taken.has(base)) {
    return base
  }
  for (let suffix = 2; ; suffix += 1) {
    const id = `${base}-${suffix}`
    if (!taken.has(id)) {
      return id
    }
  }
}

function stringOr(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value === '') {
    return fallback
  }
  return value
}
