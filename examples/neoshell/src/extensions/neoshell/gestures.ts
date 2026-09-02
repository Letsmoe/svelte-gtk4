// The shapes the gesture events in `events.ts` deliver. Svelte has no types
// for them — they arrive as the `detail` of a synthetic event — so the views
// that read a drag or a press unpack them through here rather than each
// asserting its own.

export interface PressDetail {
  x: number
  y: number
  button: number
  count: number
  width: number
  height: number
}

export interface DragDetail {
  startX: number
  startY: number
  dx: number
  dy: number
  x: number
  y: number
  width: number
  height: number
}

export const PRIMARY_BUTTON = 1
export const SECONDARY_BUTTON = 3

export function pressOf(event: { detail: unknown }): PressDetail {
  const detail = event.detail as Partial<PressDetail> | null
  if (detail === null || detail === undefined) {
    return { x: 0, y: 0, button: PRIMARY_BUTTON, count: 1, width: 0, height: 0 }
  }
  return {
    x: numberOr(detail.x, 0),
    y: numberOr(detail.y, 0),
    button: numberOr(detail.button, PRIMARY_BUTTON),
    count: numberOr(detail.count, 1),
    width: numberOr(detail.width, 0),
    height: numberOr(detail.height, 0),
  }
}

export function dragOf(event: { detail: unknown }): DragDetail {
  const detail = event.detail as Partial<DragDetail> | null
  if (detail === null || detail === undefined) {
    return { startX: 0, startY: 0, dx: 0, dy: 0, x: 0, y: 0, width: 0, height: 0 }
  }
  return {
    startX: numberOr(detail.startX, 0),
    startY: numberOr(detail.startY, 0),
    dx: numberOr(detail.dx, 0),
    dy: numberOr(detail.dy, 0),
    x: numberOr(detail.x, 0),
    y: numberOr(detail.y, 0),
    width: numberOr(detail.width, 0),
    height: numberOr(detail.height, 0),
  }
}

function numberOr(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number') {
    return fallback
  }
  return value
}
