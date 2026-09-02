import { describe, expect, test } from 'bun:test'
import { batteryOf, devicesOf, iconOf, macsOf, stateOf } from '../bluetooth/backend.js'

const SHOW = [
  'Controller AA:BB:CC:DD:EE:FF (public)',
  '\tName: neoshell-host',
  '\tAlias: neoshell-host',
  '\tPowered: yes',
  '\tDiscoverable: no',
  '\tDiscovering: no',
].join('\n')

const DEVICES = [
  'Device AA:BB:CC:DD:EE:01 Sony WH-1000XM4',
  'Device AA:BB:CC:DD:EE:02 Magic Mouse',
  'Device AA:BB:CC:DD:EE:03 Pixel 8',
].join('\n')

const INFO = [
  'Device AA:BB:CC:DD:EE:01 (public)',
  '\tName: Sony WH-1000XM4',
  '\tPaired: yes',
  '\tTrusted: yes',
  '\tConnected: yes',
  '\tIcon: audio-headset',
  '\tBattery Percentage: 0x5a (90)',
].join('\n')

describe('adapter state', () => {
  test('show output becomes the retained adapter state', () => {
    const state = stateOf(SHOW)

    expect(state.available).toBe(true)
    expect(state.powered).toBe(true)
    expect(state.discovering).toBe(false)
    expect(state.adapter).toBe('neoshell-host')
  })

  // No controller means bluetoothctl prints nothing at all; that is a machine
  // without an adapter, not an adapter that is switched off.
  test('no controller reports unavailable rather than powered off', () => {
    expect(stateOf('')).toEqual({
      available: false,
      powered: false,
      discovering: false,
      adapter: '',
    })
  })

  test('a powered-down adapter is still available', () => {
    const off = SHOW.replace('Powered: yes', 'Powered: no')

    expect(stateOf(off).available).toBe(true)
    expect(stateOf(off).powered).toBe(false)
  })
})

describe('device list', () => {
  test('connected devices sort first, then paired, then the rest by name', () => {
    const devices = devicesOf(
      DEVICES,
      macsOf('Device AA:BB:CC:DD:EE:02 Magic Mouse'),
      macsOf('Device AA:BB:CC:DD:EE:01 Sony WH-1000XM4\nDevice AA:BB:CC:DD:EE:02 Magic Mouse'),
    )

    expect(devices.map((device) => device.name)).toEqual([
      'Magic Mouse',
      'Sony WH-1000XM4',
      'Pixel 8',
    ])
    expect(devices[0].connected).toBe(true)
    expect(devices[1].paired).toBe(true)
    expect(devices[2].paired).toBe(false)
  })

  test('a name containing spaces is kept whole', () => {
    expect(devicesOf(DEVICES, new Set(), new Set())[2].name).toBe('Sony WH-1000XM4')
  })

  test('lines that are not devices are ignored', () => {
    const noise = 'Agent registered\nDevice AA:BB:CC:DD:EE:01 Speaker\n[NEW] something'

    expect(devicesOf(noise, new Set(), new Set())).toHaveLength(1)
  })
})

describe('device info', () => {
  // The hex prefix is the raw characteristic value; the decimal in parentheses
  // is the percentage to show.
  test('the decimal battery reading is used, not the hex one', () => {
    expect(batteryOf(INFO)).toBe(90)
  })

  test('a device that reports no battery is marked as having none', () => {
    expect(batteryOf('\tName: Magic Mouse\n\tConnected: yes')).toBe(-1)
  })

  test('the freedesktop icon name comes through for the row icon', () => {
    expect(iconOf(INFO)).toBe('audio-headset')
    expect(iconOf('\tName: Thing')).toBe('')
  })
})
