import { describe, expect, test } from 'bun:test'
import { categoryOf, maxOf, resolveConfig, stateOf } from '../airquality/backend.js'
import { sectionOf } from '../lib/config.js'

const BERLIN = { latitude: 52.52, longitude: 13.41, place: 'Berlin' }

// The hourly block starts at midnight, so it always leads with hours already
// past — the card's "now" column is nowhere near index 0. SO₂ is left out on
// purpose: Open-Meteo omits a pollutant it has no model for.
const READING = {
  current: {
    time: '2026-08-30T14:00',
    european_aqi: 19.6,
    us_aqi: 61,
    pm2_5: 7.5,
    pm10: 18.2,
    nitrogen_dioxide: 12.4,
    ozone: 64.1,
  },
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
    ],
    european_aqi: [14, 17, 19.6, 24, 27, 25, 21, 18],
    us_aqi: [48, 55, 61, 70, 74, 69, 60, 52],
  },
}

describe('air quality state', () => {
  test('a european response becomes the retained card state', () => {
    const state = stateOf({ current: { european_aqi: 19.6 } }, BERLIN, 'european')

    expect(state?.index).toBe(20)
    expect(state?.category).toBe('Good')
    expect(state?.max).toBe(100)
    expect(state?.place).toBe('Berlin')
  })

  test('the US scale reads its own field', () => {
    const payload = { current: { us_aqi: 120, european_aqi: 20 } }

    expect(stateOf(payload, BERLIN, 'us')?.index).toBe(120)
    expect(stateOf(payload, BERLIN, 'us')?.max).toBe(300)
  })

  test('a response missing the requested field publishes nothing', () => {
    expect(stateOf({ current: { us_aqi: 30 } }, BERLIN, 'european')).toBeNull()
  })
})

// The hourly strip and the pollutant list only reach the medium and large
// cards, but the backend has no idea which size is on the desktop and always
// sends both.
describe('air quality series', () => {
  test('the hourly strip starts at the hour under way, not at midnight', () => {
    const hours = stateOf(READING, BERLIN, 'european')?.hours

    expect(hours?.length).toBe(6)
    expect(hours?.[0]).toEqual({ label: 'Now', index: 20 })
    expect(hours?.[1]).toEqual({ label: '15', index: 24 })
    expect(hours?.[5].label).toBe('19')
  })

  test('the strip reads the series the configured scale names', () => {
    expect(stateOf(READING, BERLIN, 'us')?.hours[0].index).toBe(61)
  })

  test('a reading with no hourly block publishes the index alone', () => {
    const state = stateOf({ current: READING.current }, BERLIN, 'european')

    expect(state?.index).toBe(20)
    expect(state?.hours).toEqual([])
  })

  test('pollutants carry their share of the WHO guideline', () => {
    const pollutants = stateOf(READING, BERLIN, 'european')?.pollutants

    expect(pollutants?.map((entry) => entry.label)).toEqual(['PM2.5', 'PM10', 'NO₂', 'O₃'])
    expect(pollutants?.[0]).toEqual({ label: 'PM2.5', value: 8, unit: 'µg/m³', share: 0.5 })
  })

  test('a pollutant over its guideline pins the bar rather than rescaling it', () => {
    const dirty = { ...READING, current: { ...READING.current, pm2_5: 60 } }

    expect(stateOf(dirty, BERLIN, 'european')?.pollutants[0].share).toBe(1)
  })

  test('a pollutant the response left out is dropped, not shown as zero', () => {
    const pollutants = stateOf(READING, BERLIN, 'european')?.pollutants

    expect(pollutants?.some((entry) => entry.label === 'SO₂')).toBe(false)
  })
})

describe('settings resolution', () => {
  test('the config section supplies the location and scale', () => {
    const snapshot = { airquality: { place: 'Hamburg', scale: 'us' } }
    const resolved = resolveConfig({}, sectionOf(snapshot, 'airquality'))

    expect(resolved.place).toBe('Hamburg')
    expect(resolved.scale).toBe('us')
  })

  test('a section can switch back off the US scale', () => {
    expect(resolveConfig({ scale: 'us' }, { scale: 'european' }).scale).toBe('european')
  })

  test('an unknown scale falls back rather than reaching a missing field', () => {
    expect(resolveConfig({}, { scale: 'martian' }).scale).toBe('european')
  })

  test('no section at all leaves the defaults', () => {
    const resolved = resolveConfig({}, sectionOf({}, 'airquality'))

    expect(resolved.place).toBeUndefined()
    expect(resolved.scale).toBe('european')
    expect(resolved.pollMinutes).toBe(30)
  })
})

describe('index bands', () => {
  test('european bands run good to extremely poor', () => {
    expect(categoryOf(0, 'european')).toBe('Good')
    expect(categoryOf(20, 'european')).toBe('Good')
    expect(categoryOf(21, 'european')).toBe('Fair')
    expect(categoryOf(95, 'european')).toBe('Very poor')
    expect(categoryOf(140, 'european')).toBe('Extremely poor')
  })

  test('US bands run good to hazardous', () => {
    expect(categoryOf(50, 'us')).toBe('Good')
    expect(categoryOf(51, 'us')).toBe('Moderate')
    expect(categoryOf(400, 'us')).toBe('Hazardous')
  })

  test('an unknown scale falls back to the european one', () => {
    expect(maxOf('martian')).toBe(100)
    expect(categoryOf(10, 'martian')).toBe('Good')
  })
})
