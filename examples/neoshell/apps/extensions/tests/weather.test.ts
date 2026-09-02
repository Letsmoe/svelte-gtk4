import { describe, expect, test } from 'bun:test'
import { cardSectionOf, describeCode, resolveConfig, stateOf } from '../weather/backend.js'
import { sectionOf } from '../lib/config.js'
import { locationOf, resolveLocation } from '../lib/openMeteo.js'

const BERLIN = { latitude: 52.52, longitude: 13.41, place: 'Berlin' }

// A forecast day starts at midnight, so the hourly block always leads with
// hours already past — the card's "now" column is nowhere near index 0.
const FORECAST = {
  current: { time: '2026-08-30T14:00', temperature_2m: 17.4, weather_code: 61, is_day: 1 },
  hourly: {
    time: [
      '2026-08-30T12:00',
      '2026-08-30T13:00',
      '2026-08-30T14:00',
      '2026-08-30T15:00',
      '2026-08-30T16:00',
      '2026-08-30T17:00',
      '2026-08-30T18:00',
      '2026-08-30T19:00',
      '2026-08-30T20:00',
    ],
    temperature_2m: [15.1, 16.4, 17.4, 18.6, 18.2, 17.5, 16.1, 14.9, 13.7],
    weather_code: [3, 3, 61, 61, 80, 3, 2, 1, 0],
    is_day: [1, 1, 1, 1, 1, 1, 1, 0, 0],
  },
  daily: {
    time: ['2026-08-30', '2026-08-31', '2026-09-01'],
    weather_code: [61, 3, 0],
    temperature_2m_max: [19.2, 21.6, 24.4],
    temperature_2m_min: [11.8, 13.2, 12.5],
  },
}

describe('weather state', () => {
  test('a forecast response becomes the retained card state', () => {
    const state = stateOf(FORECAST, BERLIN, false)

    expect(state).not.toBeNull()
    expect(state?.place).toBe('Berlin')
    expect(state?.temperature).toBe(17)
    expect(state?.unit).toBe('°C')
    expect(state?.description).toBe('Light rain')
    expect(state?.isDay).toBe(true)
    expect(state?.high).toBe(19)
    expect(state?.low).toBe(12)
  })

  test('imperial units are labelled, not converted twice', () => {
    expect(stateOf(FORECAST, BERLIN, true)?.unit).toBe('°F')
  })

  test('a night reading keeps is_day off', () => {
    const night = { current: { ...FORECAST.current, is_day: 0 } }

    expect(stateOf(night, BERLIN, false)?.isDay).toBe(false)
  })

  test('a response without a temperature publishes nothing', () => {
    expect(stateOf({ current: { weather_code: 0 } }, BERLIN, false)).toBeNull()
    expect(stateOf(null, BERLIN, false)).toBeNull()
  })

  test('a missing daily block leaves the high/low line off', () => {
    const state = stateOf({ current: FORECAST.current }, BERLIN, false)

    expect(state?.high).toBe(-999)
    expect(state?.low).toBe(-999)
  })

  test('an unknown WMO code degrades instead of throwing', () => {
    expect(describeCode(4242)).toBe('Unknown')
  })
})

// The hourly strip and the day list only reach the medium and large cards, but
// the backend has no idea which size is on the desktop and always sends both.
describe('weather series', () => {
  test('the hourly strip starts at the hour under way, not at midnight', () => {
    const hours = stateOf(FORECAST, BERLIN, false)?.hours

    expect(hours?.length).toBe(6)
    expect(hours?.[0]).toEqual({ label: 'Now', temperature: 17, code: 61, isDay: true })
    expect(hours?.[1].label).toBe('15')
    expect(hours?.[5]).toEqual({ label: '19', temperature: 15, code: 1, isDay: false })
  })

  test('a reading offset inside its hour still selects that hour', () => {
    const offset = { ...FORECAST, current: { ...FORECAST.current, time: '2026-08-30T14:45' } }

    expect(stateOf(offset, BERLIN, false)?.hours[0].temperature).toBe(17)
  })

  test('a strip runs short rather than wrapping past the end of the series', () => {
    const late = { ...FORECAST, current: { ...FORECAST.current, time: '2026-08-30T19:00' } }

    expect(stateOf(late, BERLIN, false)?.hours.length).toBe(2)
  })

  test('the day list names today and weekdays after it', () => {
    const days = stateOf(FORECAST, BERLIN, false)?.days

    expect(days?.map((day) => day.label)).toEqual(['Today', 'Mon', 'Tue'])
    expect(days?.[1]).toEqual({ label: 'Mon', code: 3, high: 22, low: 13 })
  })

  test('a response without the series publishes the current reading alone', () => {
    const state = stateOf({ current: FORECAST.current }, BERLIN, false)

    expect(state?.temperature).toBe(17)
    expect(state?.hours).toEqual([])
    expect(state?.days).toEqual([])
  })

  test('a times array that is not all strings is dropped whole, not filtered', () => {
    const skewed = { ...FORECAST, hourly: { ...FORECAST.hourly, time: ['2026-08-30T14:00', 7] } }

    expect(stateOf(skewed, BERLIN, false)?.hours).toEqual([])
  })
})

// The mount list is normally implicit — every installed extension, no entry
// config — so the settings file is the only place a location gets set.
describe('settings resolution', () => {
  test('the config section supplies the location', () => {
    const snapshot = { weather: { place: 'Hamburg' } }

    expect(resolveConfig({}, sectionOf(snapshot, 'weather')).place).toBe('Hamburg')
  })

  test('the config section wins over the mount entry', () => {
    const resolved = resolveConfig({ place: 'Berlin', units: 'imperial' }, { place: 'Hamburg' })

    expect(resolved.place).toBe('Hamburg')
    expect(resolved.imperial).toBe(true)
  })

  test('a section setting one key leaves the others alone', () => {
    const resolved = resolveConfig({ place: 'Berlin' }, { pollMinutes: 5 })

    expect(resolved.place).toBe('Berlin')
    expect(resolved.pollMinutes).toBe(5)
  })

  test('junk in the section is ignored rather than believed', () => {
    const resolved = resolveConfig({ place: 'Berlin' }, { place: 42, pollMinutes: '9' })

    expect(resolved.place).toBe('Berlin')
    expect(resolved.pollMinutes).toBe(15)
  })

  test('no section at all leaves the defaults', () => {
    const resolved = resolveConfig({}, sectionOf({ appearance: {} }, 'weather'))

    expect(resolved.place).toBeUndefined()
    expect(resolved.imperial).toBe(false)
    expect(resolved.pollMinutes).toBe(15)
  })
})

// Two weather widgets on one desktop are expected to show two places, so a
// card's own entry is the last word on where it points.
describe('per-card settings', () => {
  const SECTION = {
    place: 'Hamburg',
    pollMinutes: 20,
    cards: { 'weather-2': { place: 'Tokyo', units: 'imperial' } },
  }

  test("a card's entry wins over the shared section", () => {
    const resolved = resolveConfig({}, SECTION, cardSectionOf(SECTION, 'weather-2'))

    expect(resolved.place).toBe('Tokyo')
    expect(resolved.imperial).toBe(true)
  })

  test('a card with no entry of its own follows the section', () => {
    const resolved = resolveConfig({}, SECTION, cardSectionOf(SECTION, 'weather'))

    expect(resolved.place).toBe('Hamburg')
    expect(resolved.imperial).toBe(false)
  })

  // Clearing the location field writes no place; an entry that already holds an
  // empty one predates that and must not read as "nowhere".
  test('a card whose place is empty follows the shared section', () => {
    const section = { place: 'Hamburg', cards: { 'weather-2': { place: '', units: 'metric' } } }
    const resolved = resolveConfig({}, section, cardSectionOf(section, 'weather-2'))

    expect(resolved.place).toBe('Hamburg')
  })

  test('a card entry setting one key leaves the rest of the section alone', () => {
    const resolved = resolveConfig({}, SECTION, cardSectionOf(SECTION, 'weather-2'))

    expect(resolved.pollMinutes).toBe(20)
  })

  test('a missing or malformed cards block resolves to no entry', () => {
    expect(cardSectionOf({}, 'weather')).toEqual({})
    expect(cardSectionOf({ cards: 'nonsense' }, 'weather')).toEqual({})
    expect(cardSectionOf({ cards: { weather: 7 } }, 'weather')).toEqual({})
  })
})

describe('location resolution', () => {
  test('explicit coordinates skip geocoding', async () => {
    const location = await resolveLocation({ latitude: 1.5, longitude: 2.5 })

    expect(location).toEqual({ latitude: 1.5, longitude: 2.5, place: '1.50, 2.50' })
  })

  test('a configured place labels explicit coordinates', async () => {
    const location = await resolveLocation({ latitude: 1, longitude: 2, place: 'Home' })

    expect(location?.place).toBe('Home')
  })

  test('no place and no coordinates means no location and no request', async () => {
    expect(await resolveLocation({})).toBeNull()
  })

  test('a geocoding hit prefers the canonical name', () => {
    expect(locationOf({ latitude: 53.55, longitude: 9.99, name: 'Hamburg' }, 'hamburg')).toEqual({
      latitude: 53.55,
      longitude: 9.99,
      place: 'Hamburg',
    })
  })

  test('a geocoding hit without coordinates is rejected', () => {
    expect(locationOf({ name: 'Nowhere' }, 'nowhere')).toBeNull()
  })
})
