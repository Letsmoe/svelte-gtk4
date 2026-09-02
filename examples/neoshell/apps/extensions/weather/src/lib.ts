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

// The backend's sentinel for a reading it did not get. A card leaves the line
// out rather than printing it.
export const NO_TEMPERATURE = -999

export interface HourEntry {
  label: string
  temperature: number
  code: number
  isDay: boolean
}

export interface DayEntry {
  label: string
  code: number
  high: number
  low: number
}

// WeatherCurrent is one weather.current message, already checked. The card
// holds it whole so the size layouts pass a single prop down.
export interface WeatherCurrent {
  place: string
  temperature: number
  unit: string
  code: number
  description: string
  isDay: boolean
  high: number
  low: number
  hours: HourEntry[]
  days: DayEntry[]
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

export function numberOf(value: unknown, fallback: number): number {
  if (typeof value === 'number') {
    return value
  }
  return fallback
}

// An entry the backend sent incomplete is dropped, not defaulted: a fabricated
// 0° in an hourly strip reads as a real forecast. flatMap does the dropping so
// each entry is validated where it is built.
export function hourEntriesOf(value: unknown): HourEntry[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap(hourEntryOf)
}

function hourEntryOf(value: unknown): HourEntry[] {
  const entry = recordOf(value)
  if (typeof entry.label !== 'string' || typeof entry.temperature !== 'number') {
    return []
  }
  return [
    {
      label: entry.label,
      temperature: entry.temperature,
      code: numberOf(entry.code, 0),
      isDay: entry.isDay !== false,
    },
  ]
}

export function dayEntriesOf(value: unknown): DayEntry[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap(dayEntryOf)
}

function dayEntryOf(value: unknown): DayEntry[] {
  const entry = recordOf(value)
  if (typeof entry.label !== 'string' || !hasRange(entry)) {
    return []
  }
  return [
    {
      label: entry.label,
      code: numberOf(entry.code, 0),
      high: entry.high as number,
      low: entry.low as number,
    },
  ]
}

function hasRange(entry: Record<string, unknown>): boolean {
  if (typeof entry.high !== 'number' || typeof entry.low !== 'number') {
    return false
  }
  return entry.high !== NO_TEMPERATURE && entry.low !== NO_TEMPERATURE
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
