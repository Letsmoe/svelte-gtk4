import { recordOf, stringOf } from '../../lib/record.js'

// What the card reads out of an airquality.current message, and the band a
// reading falls in.

export interface HourEntry {
  label: string
  index: number
}

export interface PollutantEntry {
  label: string
  value: number
  unit: string
  share: number
}

// AirQualityCurrent is one airquality.current message, already checked. The
// card holds it whole so the size layouts pass a single prop down.
export interface AirQualityCurrent {
  index: number
  category: string
  max: number
  place: string
  updatedAt: number
  hours: HourEntry[]
  pollutants: PollutantEntry[]
}

// The webview mixed a colour out of a four-stop ramp with color-mix(), so an
// index anywhere on the scale had its own shade. GTK CSS has no color-mix and
// no way to compute a colour at all, so the ramp becomes the four bands it was
// built from and the class names carry the severity.
const BANDS = ['good', 'fair', 'poor', 'severe']

export function bandOf(fraction: number): string {
  const position = Math.floor(clamped(fraction) * BANDS.length)
  return BANDS[Math.min(position, BANDS.length - 1)]
}

export function clamped(fraction: number): number {
  return Math.min(1, Math.max(0, fraction))
}

export function positiveOf(value: unknown, fallback: number): number {
  if (typeof value === 'number' && value > 0) {
    return value
  }
  return fallback
}

// An entry the backend sent incomplete is dropped, not defaulted: a fabricated
// zero in an hourly strip reads as a real forecast. flatMap does the dropping
// so each entry is validated where it is built.
export function hourEntriesOf(value: unknown): HourEntry[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap(hourEntryOf)
}

function hourEntryOf(value: unknown): HourEntry[] {
  const entry = recordOf(value)
  if (typeof entry.label !== 'string' || typeof entry.index !== 'number') {
    return []
  }
  return [{ label: entry.label, index: entry.index }]
}

export function pollutantEntriesOf(value: unknown): PollutantEntry[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap(pollutantEntryOf)
}

function pollutantEntryOf(value: unknown): PollutantEntry[] {
  const entry = recordOf(value)
  if (typeof entry.label !== 'string' || typeof entry.value !== 'number') {
    return []
  }
  return [
    {
      label: entry.label,
      value: entry.value,
      unit: stringOf(entry.unit),
      share: clamped(positiveOf(entry.share, 0)),
    },
  ]
}

// currentOf turns one airquality.current payload into the card's state, or
// null while the backend has published nothing — which is what an unconfigured
// card shows its hint for.
export function currentOf(data: unknown, now: number): AirQualityCurrent | null {
  const record = recordOf(data)
  if (typeof record.index !== 'number') {
    return null
  }
  return {
    index: record.index,
    category: stringOf(record.category),
    max: positiveOf(record.max, 100),
    place: stringOf(record.place),
    updatedAt: positiveOf(record.updatedAt, now),
    hours: hourEntriesOf(record.hours),
    pollutants: pollutantEntriesOf(record.pollutants),
  }
}
