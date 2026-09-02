// Shared Open-Meteo access for the desktop weather widgets. No API key and no
// account: coordinates in, current conditions out.
//
// A widget's location is either explicit coordinates or a place name geocoded
// once at mount. Neither configured means no location, and the extension makes
// no request at all — a shell does not guess where its user is.

export interface Location {
  latitude: number
  longitude: number
  place: string
}

export interface LocationConfig {
  place?: string
  latitude?: number
  longitude?: number
}

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search'

export async function resolveLocation(config: LocationConfig): Promise<Location | null> {
  const { latitude, longitude, place } = config
  if (typeof latitude === 'number' && typeof longitude === 'number') {
    return { latitude, longitude, place: labelFor(place, latitude, longitude) }
  }
  if (place === undefined || place === '') {
    return null
  }
  return geocode(place)
}

async function geocode(place: string): Promise<Location | null> {
  const url = `${GEOCODING_URL}?name=${encodeURIComponent(place)}&count=1&format=json`
  const results = recordOf(await fetchJson(url)).results
  if (!Array.isArray(results) || results.length === 0) {
    console.error(`open-meteo: no coordinates found for "${place}"`)
    return null
  }
  return locationOf(results[0], place)
}

export function locationOf(result: unknown, requested: string): Location | null {
  const entry = recordOf(result)
  const { latitude, longitude } = entry
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return null
  }
  let place = requested
  if (typeof entry.name === 'string' && entry.name !== '') {
    place = entry.name
  }
  return { latitude, longitude, place }
}

export async function fetchJson(url: string): Promise<unknown> {
  try {
    return await requestJson(url)
  } catch (error) {
    console.error(`open-meteo: request to ${url} failed:`, error)
    return null
  }
}

async function requestJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) {
    console.error(`open-meteo: ${url} returned ${response.status}`)
    return null
  }
  return response.json()
}

export function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  return value as Record<string, unknown>
}

// HourWindow is one column of a card's hourly strip: where to read the series
// and what to call the column.
export interface HourWindow {
  index: number
  label: string
}

// Every hourly block starts at midnight of the first forecast day, so a card's
// "now" column is the entry whose hour matches the current reading's — not
// index 0, and not the first strictly later entry either, which would skip the
// hour already under way. Runs short at the end of the series rather than
// wrapping.
export function hourWindowOf(
  hourly: Record<string, unknown>,
  currentTime: unknown,
  count: number,
): HourWindow[] {
  const times = stringArrayOf(hourly.time)
  const start = currentHourIndex(times, currentTime)
  if (start < 0) {
    return []
  }
  const window = times.slice(start, start + count)
  return window.map((time, offset) => ({ index: start + offset, label: hourLabelOf(time, offset) }))
}

function currentHourIndex(times: string[], currentTime: unknown): number {
  if (typeof currentTime !== 'string') {
    return 0
  }
  const hour = hourKeyOf(currentTime)
  return times.findIndex((time) => hourKeyOf(time) >= hour)
}

// "2026-08-30T14:00" down to "2026-08-30T14": local ISO timestamps compare as
// strings, so the truncated form orders hours without parsing a date.
function hourKeyOf(time: string): string {
  return time.slice(0, 13)
}

function hourLabelOf(time: string, offset: number): string {
  if (offset === 0) {
    return 'Now'
  }
  return time.slice(11, 13)
}

// The series arrive as parallel arrays indexed by time, so one bad entry must
// not shift the others: a non-string time array is dropped whole rather than
// filtered.
export function stringArrayOf(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return []
  }
  return value
}

export function numberAt(values: unknown, index: number): number {
  if (!Array.isArray(values) || typeof values[index] !== 'number') {
    return 0
  }
  return values[index]
}

function labelFor(place: string | undefined, latitude: number, longitude: number): string {
  if (place !== undefined && place !== '') {
    return place
  }
  return `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`
}
