import { describe, expect, test } from 'bun:test'
import {
  BOTTOM_MARGIN_PX,
  GAP_PX,
  MARGIN_PX,
  MAX_UNIT_PX,
  SNAP_PX,
  TOP_PX,
  clampPoint,
  firstFreeSpot,
  overlaps,
  sizePx,
  snapPoint,
  spanOf,
  unitOf,
} from '../neoshell/src/freeform.js'

const VIEWPORT = { width: 1920, height: 1080 }
const WIDTHS = [1280, 1366, 1440, 1920, 2560, 3440, 3840]

const SMALL = sizePx(unitOf(VIEWPORT.width), spanOf('small'))

describe('the sizing unit', () => {
  test('never grows past the design size, at any width', () => {
    for (const width of WIDTHS) {
      expect(unitOf(width)).toBeLessThanOrEqual(MAX_UNIT_PX)
    }
  })

  test('stays as close to the design size as an even division allows', () => {
    for (const width of WIDTHS) {
      expect(unitOf(width)).toBeGreaterThan(MAX_UNIT_PX - GAP_PX - 1)
    }
  })

  test('a viewport too narrow for one unit still yields a usable one', () => {
    expect(unitOf(0)).toBe(1)
    expect(unitOf(60)).toBeGreaterThan(0)
  })

  test('a span carries the gutters that would have sat between its units', () => {
    expect(sizePx(96, spanOf('small'))).toEqual({ width: 200, height: 200 })
    expect(sizePx(96, spanOf('medium'))).toEqual({ width: 408, height: 200 })
    expect(sizePx(96, spanOf('large'))).toEqual({ width: 408, height: 408 })
  })

  test('unknown sizes fall back to the smallest widget', () => {
    expect(spanOf('enormous')).toEqual({ columns: 2, rows: 2 })
    expect(spanOf(undefined)).toEqual({ columns: 2, rows: 2 })
  })
})

describe('staying on the desktop', () => {
  test('a point is held inside the band between the topbar and the dock', () => {
    expect(clampPoint({ x: -500, y: -500 }, SMALL, VIEWPORT)).toEqual({ x: MARGIN_PX, y: TOP_PX })
  })

  test('a point off the far edge comes back by its own size', () => {
    const clamped = clampPoint({ x: 99999, y: 99999 }, SMALL, VIEWPORT)

    expect(clamped.x).toBe(VIEWPORT.width - MARGIN_PX - SMALL.width)
    expect(clamped.y).toBe(VIEWPORT.height - BOTTOM_MARGIN_PX - SMALL.height)
  })

  test('a viewport smaller than the widget still yields a placeable point', () => {
    expect(clampPoint({ x: 0, y: 0 }, SMALL, { width: 100, height: 100 })).toEqual({
      x: MARGIN_PX,
      y: TOP_PX,
    })
  })

  test('rects that only touch do not overlap', () => {
    const left = { x: 0, y: 0, width: 100, height: 100 }

    expect(overlaps(left, { x: 100, y: 0, width: 100, height: 100 })).toBe(false)
    expect(overlaps(left, { x: 99, y: 0, width: 100, height: 100 })).toBe(true)
  })
})

// The guides are the whole explanation of a free-form drop, so what snaps and
// what draws a line are both part of the contract.
describe('snapping and guides', () => {
  test('a near miss on the left margin snaps flush and draws a line', () => {
    const snapped = snapPoint({ x: MARGIN_PX + 3, y: 500 }, SMALL, [], VIEWPORT)

    expect(snapped.point.x).toBe(MARGIN_PX)
    expect(snapped.guides).toContainEqual({ vertical: true, position: MARGIN_PX })
  })

  test('a miss wider than the threshold is left alone', () => {
    const loose = { x: MARGIN_PX + SNAP_PX + 1, y: 500 }
    const snapped = snapPoint(loose, SMALL, [], VIEWPORT)

    expect(snapped.point.x).toBe(loose.x)
    expect(snapped.guides).toEqual([])
  })

  test('a leading edge aligns with a neighbour, not with its trailing edge', () => {
    const neighbour = { x: 600, y: 100, width: SMALL.width, height: SMALL.height }
    const snapped = snapPoint({ x: 603, y: 700 }, SMALL, [neighbour], VIEWPORT)

    expect(snapped.point.x).toBe(600)
    expect(snapped.guides).toContainEqual({ vertical: true, position: 600 })
  })

  test('a widget set beside another takes the gutter, without a line in the gap', () => {
    const neighbour = { x: 600, y: 300, width: SMALL.width, height: SMALL.height }
    const flush = 600 + SMALL.width + GAP_PX
    const snapped = snapPoint({ x: flush + 2, y: 300 }, SMALL, [neighbour], VIEWPORT)

    expect(snapped.point.x).toBe(flush)
    expect(snapped.guides.some((guide) => guide.vertical)).toBe(false)
  })

  test('both axes snap independently', () => {
    const snapped = snapPoint({ x: MARGIN_PX + 2, y: TOP_PX + 2 }, SMALL, [], VIEWPORT)

    expect(snapped.point).toEqual({ x: MARGIN_PX, y: TOP_PX })
    expect(snapped.guides).toHaveLength(2)
  })

  test('the screen edge wins a tie against a neighbour', () => {
    const neighbour = { x: MARGIN_PX + 4, y: 900, width: SMALL.width, height: SMALL.height }
    const snapped = snapPoint({ x: MARGIN_PX + 2, y: 500 }, SMALL, [neighbour], VIEWPORT)

    expect(snapped.point.x).toBe(MARGIN_PX)
  })
})

describe('auto placement', () => {
  test('icons flow from the left, widgets from the right', () => {
    expect(firstFreeSpot(SMALL, [], VIEWPORT, false).x).toBe(MARGIN_PX)
    expect(firstFreeSpot(SMALL, [], VIEWPORT, true).x).toBe(
      VIEWPORT.width - MARGIN_PX - SMALL.width,
    )
  })

  test('a taken spot is stepped over rather than drawn on', () => {
    const taken = [{ x: MARGIN_PX, y: TOP_PX, width: SMALL.width, height: SMALL.height }]
    const spot = firstFreeSpot(SMALL, taken, VIEWPORT, false)

    expect(overlaps({ ...spot, ...SMALL }, taken[0])).toBe(false)
  })

  test('a column fills downwards before the next one starts', () => {
    const first = firstFreeSpot(SMALL, [], VIEWPORT, false)
    const taken = [{ ...first, ...SMALL }]
    const second = firstFreeSpot(SMALL, taken, VIEWPORT, false)

    expect(second.x).toBe(first.x)
    expect(second.y).toBeGreaterThan(first.y)
  })

  test('a desktop with no room left still returns a point on it', () => {
    const wall = [{ x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height }]
    const spot = firstFreeSpot(SMALL, wall, VIEWPORT, false)

    expect(spot).toEqual({ x: MARGIN_PX, y: TOP_PX })
  })
})
