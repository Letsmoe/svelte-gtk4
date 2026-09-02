import type { Plugin } from '@neoworks/extension-system'
import { requireService } from '../../lib/services.js'
import { RetainedTopics } from '../../lib/bus.js'
import type { BusService } from '../../lib/bus.js'
import { pickNumber, pickString, sectionOf } from '../../lib/config.js'
import { fetchJson, hourWindowOf, numberAt, recordOf, resolveLocation } from '../../lib/openMeteo.js'
import type { Location } from '../../lib/openMeteo.js'
import { startPolling } from '../../lib/poll.js'

// airquality: the current air quality index for one place as a retained bus
// topic, from the Open-Meteo air quality API.
//
//   airquality.current  {index, scale, category, max, place, hours,
//                        pollutants, updatedAt}
//
// max is the top of the card's scale bar and a pollutant carries its own share
// of the guideline, so the view needs no table of its own. hours and pollutants
// feed the wider card sizes; the small card reads neither, and the backend has
// no idea which size is on the desktop.
//
// Settings come from the config topic's "airquality" section, over anything the
// mount entry carried:
//
//   "airquality": {"place": "Hamburg", "scale": "us", "pollMinutes": 30}
//
// Location handling matches the weather extension: no configured location, no
// request.

interface AirQualityConfig {
  place?: string
  latitude?: number
  longitude?: number
  scale?: string
  pollMinutes?: number
}

interface ResolvedConfig {
  place?: string
  latitude?: number
  longitude?: number
  scale: string
  pollMinutes: number
}

export interface HourEntry {
  label: string
  index: number
}

export interface PollutantEntry {
  label: string
  value: number
  unit: string
  // Share of the pollutant's guideline concentration, clamped to 1: the bar it
  // draws is a full track, not an open-ended axis.
  share: number
}

export interface AirQualityState {
  index: number
  scale: string
  category: string
  max: number
  place: string
  hours: HourEntry[]
  pollutants: PollutantEntry[]
  updatedAt: number
}

interface Band {
  limit: number
  label: string
}

// A pollutant the large card lists: the Open-Meteo field, how the card names
// it, and the concentration its bar reads as full.
interface Pollutant {
  field: string
  label: string
  guideline: number
}

const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality'
const US_SCALE = 'us'
// What the medium and large cards have room for: six hourly columns, and the
// pollutant rows under them on the large card.
const HOUR_COUNT = 6
const CONCENTRATION_UNIT = 'µg/m³'

// WHO 2021 air quality guidelines — 24-hour means, except ozone, which is the
// 8-hour peak-season level. A bar reads full at the guideline, so a reading
// over it pins rather than rescaling the others.
const POLLUTANTS: Pollutant[] = [
  { field: 'pm2_5', label: 'PM2.5', guideline: 15 },
  { field: 'pm10', label: 'PM10', guideline: 45 },
  { field: 'nitrogen_dioxide', label: 'NO₂', guideline: 25 },
  { field: 'ozone', label: 'O₃', guideline: 100 },
  { field: 'sulphur_dioxide', label: 'SO₂', guideline: 40 },
]

// The European index tops out at 100 for "very poor" and keeps counting above
// it; the US index runs to 500 but everything past 300 is one band, so the bar
// stops where the colours do.
const EUROPEAN_BANDS: Band[] = [
  { limit: 20, label: 'Good' },
  { limit: 40, label: 'Fair' },
  { limit: 60, label: 'Moderate' },
  { limit: 80, label: 'Poor' },
  { limit: 100, label: 'Very poor' },
]
const EUROPEAN_MAX = 100

const US_BANDS: Band[] = [
  { limit: 50, label: 'Good' },
  { limit: 100, label: 'Moderate' },
  { limit: 150, label: 'Unhealthy for some' },
  { limit: 200, label: 'Unhealthy' },
  { limit: 300, label: 'Very unhealthy' },
]
const US_MAX = 300

const airQualityExtension: Plugin.Object<AirQualityConfig | undefined> = {
  name: 'airquality',
  inject: ['bus'],
  apply(context, config) {
    const bus = requireService<BusService>(context, 'bus')
    const topics = new RetainedTopics(bus)
    context.effect(() => () => topics.withdrawAll())
    const card = new AirQualityCard(topics, config)
    // The retained snapshot replays on subscribe, so the settings are in place
    // before the poll interval below is read.
    context.effect(() =>
      bus.subscribe('config', (message) => {
        card.configure(message.data)
      }),
    )
    startPolling(context, card.pollIntervalMs(), () => card.refresh())
  },
}

export default airQualityExtension

// The location is kept between polls and re-resolved only when the configured
// one changes: config republishes on every unrelated edit, and a place name
// costs a geocoding request.
class AirQualityCard {
  private readonly topics: RetainedTopics
  private readonly mountConfig: AirQualityConfig
  private options: ResolvedConfig
  private locationKey: string
  private location: Location | null = null

  constructor(topics: RetainedTopics, mountConfig: AirQualityConfig | undefined) {
    this.topics = topics
    this.mountConfig = mountConfigOf(mountConfig)
    this.options = resolveConfig(this.mountConfig, {})
    this.locationKey = locationKeyOf(this.options)
  }

  pollIntervalMs(): number {
    return this.options.pollMinutes * 60_000
  }

  configure(snapshot: unknown): void {
    this.options = resolveConfig(this.mountConfig, sectionOf(snapshot, 'airquality'))
    const key = locationKeyOf(this.options)
    if (key === this.locationKey) {
      return
    }
    this.locationKey = key
    this.location = null
    void this.refresh()
  }

  async refresh(): Promise<void> {
    if (this.location === null) {
      this.location = await resolveLocation(this.options)
    }
    if (this.location === null) {
      return
    }
    const state = await fetchCurrent(this.location, this.options.scale)
    if (state !== null) {
      this.topics.set('airquality.current', state)
    }
  }
}

export function resolveConfig(
  mountConfig: AirQualityConfig,
  section: Record<string, unknown>,
): ResolvedConfig {
  const resolved: ResolvedConfig = { scale: 'european', pollMinutes: 30 }
  applyConfig(resolved, mountConfig)
  applyConfig(resolved, sectionConfigOf(section))
  return resolved
}

function applyConfig(resolved: ResolvedConfig, config: AirQualityConfig): void {
  if (config.place !== undefined) {
    resolved.place = config.place
  }
  if (config.latitude !== undefined) {
    resolved.latitude = config.latitude
  }
  if (config.longitude !== undefined) {
    resolved.longitude = config.longitude
  }
  if (config.scale !== undefined) {
    resolved.scale = normalizeScale(config.scale)
  }
  if (config.pollMinutes !== undefined && config.pollMinutes > 0) {
    resolved.pollMinutes = config.pollMinutes
  }
}

function normalizeScale(scale: string): string {
  if (scale === US_SCALE) {
    return US_SCALE
  }
  return 'european'
}

function sectionConfigOf(section: Record<string, unknown>): AirQualityConfig {
  return {
    place: pickString(section, 'place'),
    latitude: pickNumber(section, 'latitude'),
    longitude: pickNumber(section, 'longitude'),
    scale: pickString(section, 'scale'),
    pollMinutes: pickNumber(section, 'pollMinutes'),
  }
}

function mountConfigOf(config: AirQualityConfig | undefined): AirQualityConfig {
  if (config === undefined) {
    return {}
  }
  return config
}

function locationKeyOf(options: ResolvedConfig): string {
  return JSON.stringify([options.place, options.latitude, options.longitude])
}

async function fetchCurrent(location: Location, scale: string): Promise<AirQualityState | null> {
  const payload = await fetchJson(airQualityUrl(location, scale))
  if (payload === null) {
    return null
  }
  return stateOf(payload, location, scale)
}

function airQualityUrl(location: Location, scale: string): string {
  const query = [
    `latitude=${location.latitude}`,
    `longitude=${location.longitude}`,
    `current=${[indexField(scale), ...pollutantFields()].join(',')}`,
    `hourly=${indexField(scale)}`,
    'timezone=auto',
    // Two days, so the strip still has six hours ahead of it late at night.
    'forecast_days=2',
  ]
  return `${AIR_QUALITY_URL}?${query.join('&')}`
}

function pollutantFields(): string[] {
  return POLLUTANTS.map((pollutant) => pollutant.field)
}

function indexField(scale: string): string {
  if (scale === US_SCALE) {
    return 'us_aqi'
  }
  return 'european_aqi'
}

export function stateOf(payload: unknown, location: Location, scale: string): AirQualityState | null {
  const reading = recordOf(payload)
  const current = recordOf(reading.current)
  const index = current[indexField(scale)]
  if (typeof index !== 'number') {
    return null
  }
  return {
    index: Math.round(index),
    scale,
    category: categoryOf(index, scale),
    max: maxOf(scale),
    place: location.place,
    hours: hoursOf(reading, current.time, scale),
    pollutants: pollutantsOf(current),
    updatedAt: Date.now(),
  }
}

function hoursOf(
  reading: Record<string, unknown>,
  currentTime: unknown,
  scale: string,
): HourEntry[] {
  const hourly = recordOf(reading.hourly)
  const series = hourly[indexField(scale)]
  return hourWindowOf(hourly, currentTime, HOUR_COUNT).map((hour) => ({
    label: hour.label,
    index: Math.round(numberAt(series, hour.index)),
  }))
}

// A pollutant the response left out is dropped rather than shown as zero: an
// absent reading and clean air look identical once it reaches the card.
function pollutantsOf(current: Record<string, unknown>): PollutantEntry[] {
  return POLLUTANTS.flatMap((pollutant) => pollutantEntryOf(pollutant, current))
}

function pollutantEntryOf(
  pollutant: Pollutant,
  current: Record<string, unknown>,
): PollutantEntry[] {
  const value = current[pollutant.field]
  if (typeof value !== 'number') {
    return []
  }
  return [
    {
      label: pollutant.label,
      value: Math.round(value),
      unit: CONCENTRATION_UNIT,
      share: Math.min(1, Math.max(0, value / pollutant.guideline)),
    },
  ]
}

export function categoryOf(index: number, scale: string): string {
  for (const band of bandsOf(scale)) {
    if (index <= band.limit) {
      return band.label
    }
  }
  return worstLabelOf(scale)
}

export function maxOf(scale: string): number {
  if (scale === US_SCALE) {
    return US_MAX
  }
  return EUROPEAN_MAX
}

function bandsOf(scale: string): Band[] {
  if (scale === US_SCALE) {
    return US_BANDS
  }
  return EUROPEAN_BANDS
}

function worstLabelOf(scale: string): string {
  if (scale === US_SCALE) {
    return 'Hazardous'
  }
  return 'Extremely poor'
}
