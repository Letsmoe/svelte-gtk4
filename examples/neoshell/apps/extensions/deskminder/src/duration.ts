// How long a reminder has to run, in the two shapes the pill can produce it:
// a stretch of the drag, or a wall-clock time typed into the chip. Which one
// it is has to survive until submission — a duration dragged to 56 minutes
// stays 56 minutes while the text is typed, while one set to 14:30 stays 14:30
// and quietly loses a minute a minute.

export const MAX_DRAG_MINUTES = 100
// Full travel of the duration drag: 100 minutes over 500 px is roughly five
// pixels a minute — coarse enough to sweep the range in one gesture, fine
// enough to land on a single minute.
export const DRAG_TRAVEL_PX = 500
export const MINUTE_MS = 60_000

export interface Clock {
  hours: number
  minutes: number
}

export type Duration =
  | { kind: 'minutes'; minutes: number }
  | { kind: 'clock'; dueAt: number }

const CLOCK_PATTERN = /^(\d{1,2}):([0-5]\d)$/

export function minutesFromDrag(deltaX: number): number {
  return Math.round((deltaX / DRAG_TRAVEL_PX) * MAX_DRAG_MINUTES)
}

export function clampMinutes(minutes: number): number {
  return Math.min(MAX_DRAG_MINUTES, Math.max(0, minutes))
}

export function resolvedDueAt(duration: Duration, now: number): number {
  if (duration.kind === 'clock') {
    return duration.dueAt
  }
  return now + duration.minutes * MINUTE_MS
}

// The minutes the chip shows. A dragged duration reports what was dragged; a
// wall-clock one reports the gap that is left, rounded up so a reminder due in
// forty seconds reads "1 min" rather than "0 min".
export function displayedMinutes(duration: Duration, now: number): number {
  if (duration.kind === 'minutes') {
    return duration.minutes
  }
  return minutesUntil(duration.dueAt, now)
}

export function minutesUntil(dueAt: number, now: number): number {
  return Math.max(0, Math.ceil((dueAt - now) / MINUTE_MS))
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`
  }
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (rest === 0) {
    return `${hours} h`
  }
  return `${hours} h ${rest} min`
}

// How much of a countdown is left, 0 to 1, for the ring around a pending
// reminder. A reminder persisted before armedAt was recorded carries 0 and has
// no span to measure against: it reads as untouched rather than as finished,
// since a full ring on an old entry is less wrong than an empty one.
export function remainingFraction(armedAt: number, dueAt: number, now: number): number {
  const span = dueAt - armedAt
  if (armedAt <= 0 || span <= 0) {
    return 1
  }
  return Math.min(1, Math.max(0, (dueAt - now) / span))
}

// The single figure inside the ring: minutes while there is under an hour to
// go, whole hours above that.
export function compactRemaining(dueAt: number, now: number): string {
  const minutes = minutesUntil(dueAt, now)
  if (minutes < 60) {
    return `${minutes}`
  }
  return `${Math.round(minutes / 60)}h`
}

export function clockOf(epochMs: number): string {
  const date = new Date(epochMs)
  return `${padded(date.getHours())}:${padded(date.getMinutes())}`
}

export function parseClock(text: string): Clock | null {
  const match = CLOCK_PATTERN.exec(text.trim())
  if (match === null) {
    return null
  }
  const hours = Number(match[1])
  if (hours > 23) {
    return null
  }
  return { hours, minutes: Number(match[2]) }
}

// A clock time that has already passed today means tomorrow — 09:00 typed in
// the afternoon is the morning reminder, not one that fires immediately.
export function dueAtFromClock(clock: Clock, now: number): number {
  const due = new Date(now)
  due.setHours(clock.hours, clock.minutes, 0, 0)
  if (due.getTime() <= now) {
    due.setDate(due.getDate() + 1)
  }
  return due.getTime()
}

function padded(value: number): string {
  return value.toString().padStart(2, '0')
}
