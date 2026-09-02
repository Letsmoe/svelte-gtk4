import { numberOf, recordOf, stringOf } from '../../lib/record.js'

// What the card reads out of a weather.current message, and the icon name it
// draws a condition with.

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

// One themed icon per WMO condition group. The webview build drew these as
// inline SVG because the shell served no icon font; GTK resolves a name
// through the icon theme, and Adwaita already ships the whole weather set.
// Clear skies are the only condition that differs between day and night.
export function weatherIcon(code: number, isDay: boolean): string {
  if (code <= 1) {
    return clearIcon(isDay)
  }
  return cloudyIconOf(code)
}

function clearIcon(isDay: boolean): string {
  if (isDay) {
    return 'weather-clear-symbolic'
  }
  return 'weather-clear-night-symbolic'
}

function cloudyIconOf(code: number): string {
  if (code <= 2) {
    return 'weather-few-clouds-symbolic'
  }
  if (code <= 3) {
    return 'weather-overcast-symbolic'
  }
  if (code <= 48) {
    return 'weather-fog-symbolic'
  }
  if (code <= 67) {
    return 'weather-showers-symbolic'
  }
  if (code <= 77) {
    return 'weather-snow-symbolic'
  }
  if (code <= 82) {
    return 'weather-showers-symbolic'
  }
  if (code <= 86) {
    return 'weather-snow-symbolic'
  }
  return 'weather-storm-symbolic'
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

// currentOf turns one weather.current payload into the card's state, or null
// while the backend has published nothing — which is what an unconfigured card
// shows its hint for.
export function currentOf(data: unknown): WeatherCurrent | null {
  const record = recordOf(data)
  if (typeof record.temperature !== 'number') {
    return null
  }
  return {
    place: stringOf(record.place),
    temperature: record.temperature,
    unit: stringOf(record.unit),
    code: numberOf(record.code, 0),
    description: stringOf(record.description),
    isDay: record.isDay !== false,
    high: numberOf(record.high, NO_TEMPERATURE),
    low: numberOf(record.low, NO_TEMPERATURE),
    hours: hourEntriesOf(record.hours),
    days: dayEntriesOf(record.days),
  }
}
