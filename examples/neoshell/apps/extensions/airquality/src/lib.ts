import type { Context } from '@neoworks/extension-system'

// BusLike mirrors the surface runtime's BusClient; views receive it through
// the 'bus' service. Every extension carries its own copy: an extension is a
// self-contained directory, and a views bundle that imports across extensions
// could not be dropped in on its own.

export interface BusMessage {
  type: string
  data: unknown
}

export interface BusLike {
  publish(type: string, data: unknown): void
  subscribe(pattern: string, handler: (message: BusMessage) => void): () => void
  call(type: string, data: unknown, timeoutMs?: number): Promise<unknown>
}

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

// The scale bar's gradient, as stops the strip and the pollutant rows sample
// so a colour means the same severity everywhere on the card.
const SCALE_STOPS = [
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-error)',
  'var(--color-accent)',
]

// colourAt mixes the two stops a fraction of the way along the scale falls
// between. Sampling the same ramp the bar is painted with keeps a single index
// from having two colours on one card.
export function colourAt(fraction: number): string {
  const position = clamped(fraction) * (SCALE_STOPS.length - 1)
  const lower = Math.min(Math.floor(position), SCALE_STOPS.length - 2)
  const mix = (position - lower) * 100
  return `color-mix(in oklab, ${SCALE_STOPS[lower + 1]} ${mix}%, ${SCALE_STOPS[lower]})`
}

export function clamped(fraction: number): number {
  return Math.min(1, Math.max(0, fraction))
}

export function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  return value as Record<string, unknown>
}

export function stringOf(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  return ''
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

// requireService reads a service the view plugin listed in its inject, where
// the kernel guarantees presence — it throws instead of returning undefined so
// callers skip the null check.
export function requireService<Value>(context: Context, name: string): Value {
  const value = context.get(name) as Value | undefined
  if (value === undefined) {
    throw new Error(`views: service "${name}" is not available`)
  }
  return value
}
