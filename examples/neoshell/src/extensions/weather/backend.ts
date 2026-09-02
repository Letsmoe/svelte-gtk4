import type { Plugin } from '@neoworks/extension-system'
import { requireService } from '../../lib/services.js'
import { RetainedTopics, registerFunction } from '../../lib/bus.js'
import type { BusService } from '../../lib/bus.js'
import { pickNumber, pickString, sectionOf } from '../../lib/config.js'
import {
  fetchJson,
  hourWindowOf,
  numberAt,
  recordOf,
  resolveLocation,
  stringArrayOf,
} from '../../lib/openMeteo.js'
import type { Location } from '../../lib/openMeteo.js'
import { startPolling } from '../../lib/poll.js'

// weather: current conditions for one place as a retained bus topic, from the
// Open-Meteo forecast API.
//
//   weather:watch    {id} → {ok}
//   weather.current/<id>  {place, temperature, unit, code, description, isDay,
//                          high, low, hours, days, updatedAt}
//
// hours and days carry the series the wider card sizes show; the small card
// reads none of them. Both are published on every poll because the size is a
// desktop-side setting the backend never learns about.
//
// One topic per card, not one for the extension: two weather widgets on the
// same desktop are expected to show two different places. A card announces
// itself with weather:watch when it mounts — the backend has no other way to
// learn which instances exist, since the view tree is the surface's business.
//
// Settings come from the config topic's "weather" section, over anything the
// mount entry carried, and a card's own entry under "cards" wins over both:
//
//   "weather": {
//     "place": "Hamburg", "units": "imperial", "pollMinutes": 15,
//     "cards": {"weather-2": {"place": "Tokyo"}}
//   }
//
// Without a configured location nothing is published and no request is made;
// the card renders its "set a location" hint instead.

interface WeatherConfig {
  place?: string
  latitude?: number
  longitude?: number
  units?: string
  pollMinutes?: number
}

interface ResolvedConfig {
  place?: string
  latitude?: number
  longitude?: number
  imperial: boolean
  pollMinutes: number
}

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

export interface WeatherState {
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
  updatedAt: number
}

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const NO_TEMPERATURE = -999
// What the medium and large cards have room for: six hourly columns and, on
// the large card, the coming days under them.
const HOUR_COUNT = 6
const DAY_COUNT = 6

const weatherExtension: Plugin.Object<WeatherConfig | undefined> = {
  name: 'weather',
  inject: ['bus'],
  apply(context, config) {
    const bus = requireService<BusService>(context, 'bus')
    const topics = new RetainedTopics(bus)
    context.effect(() => () => topics.withdrawAll())
    const cards = new WeatherCards(topics, config)
    // The retained snapshot replays on subscribe, so the settings are in place
    // before the poll interval below is read.
    context.effect(() =>
      bus.subscribe('config', (message) => {
        cards.configure(message.data)
      }),
    )
    registerFunction(context, bus, 'weather:watch', (data) => cards.watch(data))
    startPolling(context, cards.pollIntervalMs(), () => cards.refresh())
  },
}

export default weatherExtension

// WeatherCards owns one card per widget instance. Instances are learnt from
// weather:watch rather than from config, so a card that has never been given a
// place still gets a topic — and so renders the hint that tells the user to
// set one.
class WeatherCards {
  private readonly topics: RetainedTopics
  private readonly mountConfig: WeatherConfig
  private readonly cards = new Map<string, WeatherCard>()
  private section: Record<string, unknown> = {}

  constructor(topics: RetainedTopics, mountConfig: WeatherConfig | undefined) {
    this.topics = topics
    this.mountConfig = mountConfigOf(mountConfig)
  }

  pollIntervalMs(): number {
    return this.sharedOptions().pollMinutes * 60_000
  }

  watch(data: unknown): Record<string, unknown> {
    const id = idOf(data)
    if (id === '') {
      return { error: 'weather:watch needs a card id' }
    }
    const existing = this.cards.get(id)
    if (existing !== undefined) {
      return { ok: true }
    }
    const card = new WeatherCard(this.topics, id)
    this.cards.set(id, card)
    card.configure(this.optionsFor(id))
    return { ok: true }
  }

  configure(snapshot: unknown): void {
    this.section = sectionOf(snapshot, 'weather')
    for (const [id, card] of this.cards) {
      card.configure(this.optionsFor(id))
    }
  }

  async refresh(): Promise<void> {
    await Promise.all([...this.cards.values()].map((card) => card.refresh()))
  }

  private optionsFor(id: string): ResolvedConfig {
    return resolveConfig(this.mountConfig, this.section, cardSectionOf(this.section, id))
  }

  private sharedOptions(): ResolvedConfig {
    return resolveConfig(this.mountConfig, this.section)
  }
}

// WeatherCard holds what one instance needs between polls: its merged settings
// and its resolved location. The location is kept because a place name costs a
// geocoding request, and re-resolved only when the configured location
// actually changes — config republishes on every unrelated edit, including a
// widget being dragged.
class WeatherCard {
  private readonly topics: RetainedTopics
  private readonly topic: string
  private options: ResolvedConfig = { imperial: false, pollMinutes: 15 }
  private locationKey = ''
  private location: Location | null = null

  constructor(topics: RetainedTopics, id: string) {
    this.topics = topics
    this.topic = `weather.current/${id}`
  }

  configure(options: ResolvedConfig): void {
    this.options = options
    const key = locationKeyOf(options)
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
    const state = await fetchCurrent(this.location, this.options.imperial)
    if (state !== null) {
      this.topics.set(this.topic, state)
    }
  }
}

export function resolveConfig(
  mountConfig: WeatherConfig,
  section: Record<string, unknown>,
  cardSection: Record<string, unknown> = {},
): ResolvedConfig {
  const resolved: ResolvedConfig = { imperial: false, pollMinutes: 15 }
  applyConfig(resolved, mountConfig)
  applyConfig(resolved, sectionConfigOf(section))
  applyConfig(resolved, sectionConfigOf(cardSection))
  return resolved
}

// A card's own settings live under the section rather than beside the desktop
// layout in "widgets": the backend knows what a weather setting means and
// nothing about widget ids until a card claims one.
export function cardSectionOf(
  section: Record<string, unknown>,
  id: string,
): Record<string, unknown> {
  const cards = section.cards
  if (typeof cards !== 'object' || cards === null) {
    return {}
  }
  const card = (cards as Record<string, unknown>)[id]
  if (typeof card !== 'object' || card === null) {
    return {}
  }
  return card as Record<string, unknown>
}

function idOf(data: unknown): string {
  if (typeof data !== 'object' || data === null) {
    return ''
  }
  const { id } = data as Record<string, unknown>
  if (typeof id !== 'string') {
    return ''
  }
  return id
}

// An empty place is not a place: a card whose own entry has been cleared falls
// back to the shared section rather than losing its location.
function applyConfig(resolved: ResolvedConfig, config: WeatherConfig): void {
  if (config.place !== undefined && config.place !== '') {
    resolved.place = config.place
  }
  if (config.latitude !== undefined) {
    resolved.latitude = config.latitude
  }
  if (config.longitude !== undefined) {
    resolved.longitude = config.longitude
  }
  if (config.units !== undefined) {
    resolved.imperial = config.units === 'imperial'
  }
  if (config.pollMinutes !== undefined && config.pollMinutes > 0) {
    resolved.pollMinutes = config.pollMinutes
  }
}

function sectionConfigOf(section: Record<string, unknown>): WeatherConfig {
  return {
    place: pickString(section, 'place'),
    latitude: pickNumber(section, 'latitude'),
    longitude: pickNumber(section, 'longitude'),
    units: pickString(section, 'units'),
    pollMinutes: pickNumber(section, 'pollMinutes'),
  }
}

function mountConfigOf(config: WeatherConfig | undefined): WeatherConfig {
  if (config === undefined) {
    return {}
  }
  return config
}

function locationKeyOf(options: ResolvedConfig): string {
  return JSON.stringify([options.place, options.latitude, options.longitude])
}

async function fetchCurrent(location: Location, imperial: boolean): Promise<WeatherState | null> {
  const payload = await fetchJson(forecastUrl(location, imperial))
  if (payload === null) {
    return null
  }
  return stateOf(payload, location, imperial)
}

function forecastUrl(location: Location, imperial: boolean): string {
  const query = [
    `latitude=${location.latitude}`,
    `longitude=${location.longitude}`,
    'current=temperature_2m,weather_code,is_day',
    'hourly=temperature_2m,weather_code,is_day',
    'daily=weather_code,temperature_2m_max,temperature_2m_min',
    'timezone=auto',
    `forecast_days=${DAY_COUNT}`,
  ]
  if (imperial) {
    query.push('temperature_unit=fahrenheit')
  }
  return `${FORECAST_URL}?${query.join('&')}`
}

export function stateOf(payload: unknown, location: Location, imperial: boolean): WeatherState | null {
  const forecast = recordOf(payload)
  const current = recordOf(forecast.current)
  const { temperature_2m: temperature, weather_code: code } = current
  if (typeof temperature !== 'number' || typeof code !== 'number') {
    return null
  }
  const daily = recordOf(forecast.daily)
  return {
    place: location.place,
    temperature: Math.round(temperature),
    unit: unitLabel(imperial),
    code,
    description: describeCode(code),
    isDay: current.is_day !== 0,
    high: roundedAt(daily.temperature_2m_max, 0),
    low: roundedAt(daily.temperature_2m_min, 0),
    hours: hoursOf(forecast, current.time),
    days: daysOf(forecast),
    updatedAt: Date.now(),
  }
}

function hoursOf(forecast: Record<string, unknown>, currentTime: unknown): HourEntry[] {
  const hourly = recordOf(forecast.hourly)
  return hourWindowOf(hourly, currentTime, HOUR_COUNT).map((hour) => ({
    label: hour.label,
    temperature: roundedAt(hourly.temperature_2m, hour.index),
    code: numberAt(hourly.weather_code, hour.index),
    isDay: numberAt(hourly.is_day, hour.index) !== 0,
  }))
}

function daysOf(forecast: Record<string, unknown>): DayEntry[] {
  const daily = recordOf(forecast.daily)
  const dates = stringArrayOf(daily.time)
  return dates.slice(0, DAY_COUNT).map((date, index) => dayEntryOf(daily, index, date))
}

function dayEntryOf(daily: Record<string, unknown>, index: number, date: string): DayEntry {
  return {
    label: dayLabelOf(date, index),
    code: numberAt(daily.weather_code, index),
    high: roundedAt(daily.temperature_2m_max, index),
    low: roundedAt(daily.temperature_2m_min, index),
  }
}

function dayLabelOf(date: string, index: number): string {
  if (index === 0) {
    return 'Today'
  }
  const parsed = new Date(`${date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) {
    return date
  }
  return parsed.toLocaleDateString('en-US', { weekday: 'short' })
}

function unitLabel(imperial: boolean): string {
  if (imperial) {
    return '°F'
  }
  return '°C'
}

// A response missing a series leaves the reading out rather than guessing:
// NO_TEMPERATURE drops the card's high/low line and a day from its list.
function roundedAt(values: unknown, index: number): number {
  if (!Array.isArray(values) || typeof values[index] !== 'number') {
    return NO_TEMPERATURE
  }
  return Math.round(values[index])
}

// WMO weather interpretation codes, as Open-Meteo reports them.
const WEATHER_CODES: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Freezing fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light showers',
  81: 'Showers',
  82: 'Violent showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with hail',
}

export function describeCode(code: number): string {
  const description = WEATHER_CODES[code]
  if (description === undefined) {
    return 'Unknown'
  }
  return description
}
