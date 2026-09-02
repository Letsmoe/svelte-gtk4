import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@neoworks/extension-system'
import systemExtension, { parseBrightness } from '../system/backend.js'
import { busProvider, FakeBus, waitFor } from './helpers.js'

describe('system extension', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'neoshell-system-test-'))
  const batteryDir = join(tempDir, 'power_supply')
  const root = new Context()
  const bus = new FakeBus()

  beforeAll(async () => {
    mkdirSync(join(batteryDir, 'BAT0'), { recursive: true })
    writeFileSync(join(batteryDir, 'BAT0', 'capacity'), '70\n')
    writeFileSync(join(batteryDir, 'BAT0', 'status'), 'Charging\n')
    await root.plugin(busProvider(bus))
  })

  afterAll(async () => {
    await root.fiber.dispose()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('publishes battery state retained and tracks file changes across polls', async () => {
    const fiber = await root.plugin(systemExtension, {
      batteryDir,
      batteryPollMs: 30,
      volume: false,
      brightness: false,
    })
    await waitFor(() => bus.retained.has('system.battery'))

    expect(bus.retained.get('system.battery')).toEqual({
      percent: 70,
      charging: true,
      status: 'Charging',
    })

    writeFileSync(join(batteryDir, 'BAT0', 'capacity'), '69\n')
    writeFileSync(join(batteryDir, 'BAT0', 'status'), 'Discharging\n')
    await waitFor(() => {
      const state = bus.retained.get('system.battery') as { percent: number }
      return state.percent === 69
    })

    expect(bus.retained.get('system.battery')).toEqual({
      percent: 69,
      charging: false,
      status: 'Discharging',
    })

    await fiber.dispose()
    expect(bus.retained.has('system.battery')).toBe(false)
  })

  test('a machine without a battery publishes nothing and disposes cleanly', async () => {
    const emptyDir = join(tempDir, 'no-battery')
    mkdirSync(emptyDir, { recursive: true })
    const fiber = await root.plugin(systemExtension, {
      batteryDir: emptyDir,
      batteryPollMs: 30,
      volume: false,
      brightness: false,
    })
    await Bun.sleep(80)

    expect(bus.retained.has('system.battery')).toBe(false)
    await fiber.dispose()
  })
})

// brightnessctl -m prints one CSV line: device,class,current,percent%,max.
describe('brightness parsing', () => {
  test('the percent column becomes the slider value', () => {
    const state = parseBrightness('intel_backlight,backlight,52428,55%,96000')

    expect(state.percent).toBe(55)
    expect(state.available).toBe(true)
  })

  test('a machine with no backlight reports unavailable', () => {
    expect(parseBrightness('')).toEqual({ percent: 0, available: false })
    expect(parseBrightness('intel_backlight,backlight')).toEqual({
      percent: 0,
      available: false,
    })
  })

  test('a non-numeric percent does not become NaN on the slider', () => {
    expect(parseBrightness('dev,backlight,0,--%,100').available).toBe(false)
  })

  test('only the first device line is read', () => {
    const twoDevices = ['intel_backlight,backlight,1,20%,10', 'led,leds,1,90%,10'].join('\n')

    expect(parseBrightness(twoDevices).percent).toBe(20)
  })
})
