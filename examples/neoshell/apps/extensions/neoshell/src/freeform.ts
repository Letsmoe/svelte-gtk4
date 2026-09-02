// Free-form desktop geometry. Icons and widgets are placed by pixel, not by
// cell: a drag lands where it is dropped, and alignment comes from snapping to
// the things already on the desktop rather than from a lattice everything is
// forced onto.
//
// The unit survives from the grid, but only as a *size*: a widget is still two
// or four units across, and the unit still scales with the output so a card is
// proportional on any monitor. Nothing positions against it.

export const GAP_PX = 8
// The margin down each side of the desktop, and the edge a rect snaps to.
export const MARGIN_PX = 8
// Clears the topbar's exclusive zone: the background layer spans the whole
// output, so anything at y=0 would render behind the bar.
export const TOP_PX = 40
// Keeps the bottom clear of the dock.
export const BOTTOM_MARGIN_PX = 88
export const MAX_UNIT_PX = 96
// How near an edge has to come before it snaps. Wide enough to catch a
// deliberate alignment, narrow enough that a placement between two widgets is
// still reachable.
export const SNAP_PX = 8

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Rect extends Point, Size {}

export interface Viewport {
  width: number
  height: number
}

export interface Span {
  columns: number
  rows: number
}

// A line the desktop draws while something is being dragged, at the coordinate
// the drag snapped to.
export interface Guide {
  vertical: boolean
  position: number
}

export interface Snapped {
  point: Point
  guides: Guide[]
}

export const ICON_SPAN: Span = { columns: 1, rows: 1 }

const SPANS: Record<string, Span> = {
  small: { columns: 2, rows: 2 },
  medium: { columns: 4, rows: 2 },
  large: { columns: 4, rows: 4 },
}

const DEFAULT_SPAN: Span = SPANS.small

export const SIZE_NAMES = ['small', 'medium', 'large']

export function spanOf(size: unknown): Span {
  if (typeof size !== 'string') {
    return DEFAULT_SPAN
  }
  const span = SPANS[size]
  if (span === undefined) {
    return DEFAULT_SPAN
  }
  return span
}

// unitOf keeps a widget proportional to the output without letting it grow
// past the design size: the unit is the width divided into as many parts as it
// takes to bring each one under the maximum.
export function unitOf(viewportWidth: number): number {
  const usable = viewportWidth - 2 * MARGIN_PX
  if (usable <= MAX_UNIT_PX) {
    return Math.max(1, usable)
  }
  const columns = Math.ceil((usable + GAP_PX) / (MAX_UNIT_PX + GAP_PX))
  return (usable - (columns - 1) * GAP_PX) / columns
}

// sizePx is the pixel box of a span, gutters between the units included — the
// unit is a design measure, so a two-unit widget is two units plus the gap
// that would have sat between them.
export function sizePx(unit: number, span: Span): Size {
  return {
    width: span.columns * unit + (span.columns - 1) * GAP_PX,
    height: span.rows * unit + (span.rows - 1) * GAP_PX,
  }
}

export function rectOf(point: Point, size: Size): Rect {
  return { x: point.x, y: point.y, width: size.width, height: size.height }
}

export function overlaps(left: Rect, right: Rect): boolean {
  if (left.x + left.width <= right.x || right.x + right.width <= left.x) {
    return false
  }
  return !(left.y + left.height <= right.y || right.y + right.height <= left.y)
}

export function overlapsAny(rect: Rect, others: Rect[]): boolean {
  return others.some((other) => overlaps(rect, other))
}

// clampPoint keeps a rect inside the usable desktop — the band between the
// topbar and the dock. A monitor that shrinks must not strand what was placed
// on the larger one.
export function clampPoint(point: Point, size: Size, viewport: Viewport): Point {
  const maxX = Math.max(MARGIN_PX, viewport.width - MARGIN_PX - size.width)
  const maxY = Math.max(TOP_PX, viewport.height - BOTTOM_MARGIN_PX - size.height)
  return {
    x: Math.min(Math.max(MARGIN_PX, point.x), maxX),
    y: Math.min(Math.max(TOP_PX, point.y), maxY),
  }
}

// A candidate pairs an edge of the moving rect with a coordinate it could
// settle on. Alignment candidates draw a guide; the adjacency ones — a widget
// set one gutter away from its neighbour — snap without one, since a line
// floating in the gap between two cards explains nothing.
interface Candidate {
  edge: number
  target: number
  guide: boolean
}

export function snapPoint(
  point: Point,
  size: Size,
  others: Rect[],
  viewport: Viewport,
): Snapped {
  const horizontal = resolveAxis(horizontalCandidates(point.x, size.width, others, viewport))
  const vertical = resolveAxis(verticalCandidates(point.y, size.height, others, viewport))
  return {
    point: { x: point.x + horizontal.offset, y: point.y + vertical.offset },
    guides: [...guidesFor(horizontal, true), ...guidesFor(vertical, false)],
  }
}

interface AxisSnap {
  offset: number
  guide: number | null
}

const NO_SNAP: AxisSnap = { offset: 0, guide: null }

// The nearest candidate inside the threshold wins; a tie keeps the first,
// which is the viewport edge, so the screen beats a neighbour.
function resolveAxis(candidates: Candidate[]): AxisSnap {
  let best = NO_SNAP
  let bestDistance = SNAP_PX
  for (const candidate of candidates) {
    const distance = Math.abs(candidate.target - candidate.edge)
    if (distance < bestDistance) {
      bestDistance = distance
      best = snapFor(candidate)
    }
  }
  return best
}

function snapFor(candidate: Candidate): AxisSnap {
  const offset = candidate.target - candidate.edge
  if (!candidate.guide) {
    return { offset, guide: null }
  }
  return { offset, guide: candidate.target }
}

function guidesFor(snap: AxisSnap, vertical: boolean): Guide[] {
  if (snap.guide === null) {
    return []
  }
  return [{ vertical, position: snap.guide }]
}

function horizontalCandidates(
  x: number,
  width: number,
  others: Rect[],
  viewport: Viewport,
): Candidate[] {
  const edges = [x, x + width / 2, x + width]
  const screen = [MARGIN_PX, viewport.width / 2, viewport.width - MARGIN_PX]
  const candidates = alignmentCandidates(edges, screen)
  for (const other of others) {
    candidates.push(...alignmentCandidates(edges, [other.x, other.x + other.width / 2, other.x + other.width]))
    candidates.push({ edge: x, target: other.x + other.width + GAP_PX, guide: false })
    candidates.push({ edge: x + width, target: other.x - GAP_PX, guide: false })
  }
  return candidates
}

function verticalCandidates(
  y: number,
  height: number,
  others: Rect[],
  viewport: Viewport,
): Candidate[] {
  const edges = [y, y + height / 2, y + height]
  const screen = [TOP_PX, viewport.height / 2, viewport.height - BOTTOM_MARGIN_PX]
  const candidates = alignmentCandidates(edges, screen)
  for (const other of others) {
    candidates.push(...alignmentCandidates(edges, [other.y, other.y + other.height / 2, other.y + other.height]))
    candidates.push({ edge: y, target: other.y + other.height + GAP_PX, guide: false })
    candidates.push({ edge: y + height, target: other.y - GAP_PX, guide: false })
  }
  return candidates
}

// Leading edges align with leading edges, centres with centres and trailing
// with trailing. Aligning a left edge to a right one is the adjacency case,
// which carries a gutter and is added separately.
function alignmentCandidates(edges: number[], targets: number[]): Candidate[] {
  return edges.map((edge, index) => ({ edge, target: targets[index], guide: true }))
}

// firstFreeSpot walks the desktop in unit steps and returns the first place the
// size fits. Widgets seed from the right so they do not land on the icons,
// which flow from the left.
export function firstFreeSpot(
  size: Size,
  others: Rect[],
  viewport: Viewport,
  fromRight: boolean,
): Point {
  const lastY = viewport.height - BOTTOM_MARGIN_PX - size.height
  for (const x of columnOrigins(size, viewport, fromRight)) {
    const spot = freeSpotInColumn(x, size, others, lastY)
    if (spot !== null) {
      return spot
    }
  }
  return clampPoint({ x: MARGIN_PX, y: TOP_PX }, size, viewport)
}

function columnOrigins(size: Size, viewport: Viewport, fromRight: boolean): number[] {
  const lastX = viewport.width - MARGIN_PX - size.width
  if (fromRight) {
    return steppedDown(lastX, MARGIN_PX)
  }
  return steppedUp(MARGIN_PX, lastX)
}

function freeSpotInColumn(x: number, size: Size, others: Rect[], lastY: number): Point | null {
  for (const y of steppedUp(TOP_PX, lastY)) {
    if (!overlapsAny(rectOf({ x, y }, size), others)) {
      return { x, y }
    }
  }
  return null
}

function steppedUp(start: number, limit: number): number[] {
  const values: number[] = []
  for (let value = start; value <= limit; value += MAX_UNIT_PX + GAP_PX) {
    values.push(value)
  }
  return values
}

function steppedDown(start: number, limit: number): number[] {
  const values: number[] = []
  for (let value = start; value >= limit; value -= MAX_UNIT_PX + GAP_PX) {
    values.push(value)
  }
  return values
}
