// Where the pill sits on the desktop. Free pixel placement, clamped to the
// band the background layer actually leaves usable: the layer spans the whole
// output, so anything at y=0 renders behind the topbar and anything at the
// bottom edge renders behind the dock.

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Viewport {
  width: number
  height: number
}

const MARGIN_PX = 8
// Clears the topbar's exclusive zone.
const TOP_PX = 40
// Keeps the pill clear of the dock.
const BOTTOM_MARGIN_PX = 88

export const DEFAULT_POINT: Point = { x: 32, y: 96 }

export function clampPoint(point: Point, size: Size, viewport: Viewport): Point {
  const maxX = Math.max(MARGIN_PX, viewport.width - MARGIN_PX - size.width)
  const maxY = Math.max(TOP_PX, viewport.height - BOTTOM_MARGIN_PX - size.height)
  return {
    x: Math.min(Math.max(MARGIN_PX, point.x), maxX),
    y: Math.min(Math.max(TOP_PX, point.y), maxY),
  }
}

// pointOf reads the stored placement, falling back to the default for a pill
// that has never been moved. A half-written point is not half honoured.
export function pointOf(value: unknown): Point {
  if (typeof value !== 'object' || value === null) {
    return DEFAULT_POINT
  }
  const { x, y } = value as Point
  if (typeof x !== 'number' || typeof y !== 'number') {
    return DEFAULT_POINT
  }
  return { x, y }
}
