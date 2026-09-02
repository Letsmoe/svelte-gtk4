import { describe, expect, test } from 'bun:test'
import {
  DRAG_TRAVEL_PX,
  MAX_DRAG_MINUTES,
  MINUTE_MS,
  clampMinutes,
  clockOf,
  displayedMinutes,
  dueAtFromClock,
  formatDuration,
  minutesFromDrag,
  minutesUntil,
  parseClock,
  remainingFraction,
  resolvedDueAt,
  compactRemaining,
} from '../deskminder/src/duration.js'
import { DEFAULT_POINT, clampPoint, pointOf } from '../deskminder/src/placement.js'
import { bowedStadiumPath } from '../deskminder/src/barShape.js'

describe('deskminder duration', () => {
  test('the drag maps its full travel onto the whole range', () => {
    expect(minutesFromDrag(0)).toBe(0)
    expect(minutesFromDrag(DRAG_TRAVEL_PX)).toBe(MAX_DRAG_MINUTES)
    expect(minutesFromDrag(DRAG_TRAVEL_PX / 2)).toBe(MAX_DRAG_MINUTES / 2)
    expect(minutesFromDrag(-DRAG_TRAVEL_PX / 4)).toBe(-MAX_DRAG_MINUTES / 4)
  })

  test('dragging past either end clamps', () => {
    expect(clampMinutes(-30)).toBe(0)
    expect(clampMinutes(240)).toBe(MAX_DRAG_MINUTES)
    expect(clampMinutes(56)).toBe(56)
  })

  // The two shapes differ exactly here: a dragged duration is a length and
  // does not shrink while the text is typed; a wall-clock one is a moment and
  // does.
  test('a dragged duration holds while a wall-clock one counts down', () => {
    const now = 1_700_000_000_000
    const dragged = { kind: 'minutes' as const, minutes: 56 }
    const typed = { kind: 'clock' as const, dueAt: now + 56 * MINUTE_MS }

    expect(displayedMinutes(dragged, now + 10 * MINUTE_MS)).toBe(56)
    expect(displayedMinutes(typed, now + 10 * MINUTE_MS)).toBe(46)
    expect(resolvedDueAt(dragged, now)).toBe(typed.dueAt)
  })

  test('the remaining minutes round up and never go negative', () => {
    const now = 1_700_000_000_000
    expect(minutesUntil(now + 40 * 1000, now)).toBe(1)
    expect(minutesUntil(now + 2 * MINUTE_MS, now)).toBe(2)
    expect(minutesUntil(now - MINUTE_MS, now)).toBe(0)
  })

  test('durations read as minutes below an hour and as hours above it', () => {
    expect(formatDuration(1)).toBe('1 min')
    expect(formatDuration(56)).toBe('56 min')
    expect(formatDuration(60)).toBe('1 h')
    expect(formatDuration(100)).toBe('1 h 40 min')
  })

  test('HH:mm parses only as a real time of day', () => {
    expect(parseClock('14:30')).toEqual({ hours: 14, minutes: 30 })
    expect(parseClock(' 9:05 ')).toEqual({ hours: 9, minutes: 5 })
    expect(parseClock('24:00')).toBeNull()
    expect(parseClock('14:60')).toBeNull()
    expect(parseClock('1430')).toBeNull()
    expect(parseClock('')).toBeNull()
  })

  test('the ring empties over the span it was armed for', () => {
    const armedAt = 1_700_000_000_000
    const dueAt = armedAt + 60 * MINUTE_MS

    expect(remainingFraction(armedAt, dueAt, armedAt)).toBe(1)
    expect(remainingFraction(armedAt, dueAt, armedAt + 45 * MINUTE_MS)).toBe(0.25)
    expect(remainingFraction(armedAt, dueAt, dueAt)).toBe(0)
    expect(remainingFraction(armedAt, dueAt, dueAt + MINUTE_MS)).toBe(0)
  })

  // A reminder written before armedAt was recorded reads as 0, which would
  // otherwise make its span negative and its ring meaningless.
  test('a reminder with no armed time reads as untouched', () => {
    const now = 1_700_000_000_000
    expect(remainingFraction(0, now + MINUTE_MS, now)).toBe(1)
  })

  test('the ring carries a single figure', () => {
    const now = 1_700_000_000_000
    expect(compactRemaining(now + 56 * MINUTE_MS, now)).toBe('56')
    expect(compactRemaining(now + 30 * 1000, now)).toBe('1')
    expect(compactRemaining(now + 90 * MINUTE_MS, now)).toBe('2h')
  })

  test('a clock time that has passed today means tomorrow', () => {
    const noon = new Date(2026, 7, 31, 12, 0, 0, 0).getTime()

    const afternoon = dueAtFromClock({ hours: 14, minutes: 30 }, noon)
    expect(clockOf(afternoon)).toBe('14:30')
    expect(afternoon - noon).toBe(150 * MINUTE_MS)

    const morning = dueAtFromClock({ hours: 9, minutes: 0 }, noon)
    expect(clockOf(morning)).toBe('09:00')
    expect(morning - noon).toBe(21 * 60 * MINUTE_MS)
  })
})

describe('deskminder bar shape', () => {
  // With no bow the control points sit on the edges themselves, so the
  // quadratics degenerate to straight lines and the shape is a plain stadium.
  test('an unpulled bar is a stadium', () => {
    expect(bowedStadiumPath(200, 44, 0)).toBe(
      'path("M 22 0 Q 100 0 178 0 A 22 22 0 0 1 178 44 Q 100 44 22 44 A 22 22 0 0 1 22 0 Z")',
    )
  })

  // The waist pulls inward: the top edge sags down and the bottom edge lifts
  // up, both by twice the bow at the control point so the midpoint moves by
  // the bow itself.
  test('a pulled bar bows its edges toward the middle', () => {
    expect(bowedStadiumPath(300, 44, 5)).toBe(
      'path("M 22 0 Q 150 10 278 0 A 22 22 0 0 1 278 44 Q 150 34 22 44 A 22 22 0 0 1 22 0 Z")',
    )
  })

  test('a bar narrower than its own ends keeps them from crossing', () => {
    expect(bowedStadiumPath(30, 44, 0)).toContain('M 22 0 Q 15 0 22 0')
  })
})

describe('deskminder placement', () => {
  const viewport = { width: 1920, height: 1080 }
  const size = { width: 320, height: 44 }

  test('the pill is kept clear of the topbar and the dock', () => {
    expect(clampPoint({ x: 400, y: 5 }, size, viewport).y).toBe(40)
    expect(clampPoint({ x: 400, y: 4000 }, size, viewport).y).toBe(1080 - 88 - 44)
    expect(clampPoint({ x: -50, y: 400 }, size, viewport).x).toBe(8)
    expect(clampPoint({ x: 4000, y: 400 }, size, viewport).x).toBe(1920 - 8 - 320)
  })

  test('a placement is only honoured when both coordinates are there', () => {
    expect(pointOf({ x: 120, y: 300 })).toEqual({ x: 120, y: 300 })
    expect(pointOf({ x: 120 })).toEqual(DEFAULT_POINT)
    expect(pointOf(undefined)).toEqual(DEFAULT_POINT)
  })
})
