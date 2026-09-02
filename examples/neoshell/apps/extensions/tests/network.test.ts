import { describe, expect, test } from 'bun:test'
import {
  addressingOf,
  networksOf,
  savedNamesOf,
  stateOf,
  wifiDeviceOf,
} from '../network/backend.js'
import { splitTerse } from '../lib/proc.js'

// nmcli -t escapes a literal colon inside a value as "\:", so every fixture
// here is verbatim terse output rather than a hand-split field list.
const SCAN = [
  'yes:72:WPA2:INFINITUM3942',
  'no:88::CoffeeBar Guest',
  'no:45:WPA2:Nachbar\\:WLAN',
  'no:31:WPA2:INFINITUM3942',
].join('\n')

const ADDRESSING = [
  'IP4.ADDRESS[1]:192.168.1.42/24',
  'IP4.GATEWAY:192.168.1.1',
  'IP4.DNS[1]:192.168.1.1',
  'IP4.DNS[2]:1.1.1.1',
].join('\n')

describe('terse field splitting', () => {
  test('an escaped colon stays inside its field', () => {
    expect(splitTerse('no:45:WPA2:Nachbar\\:WLAN')).toEqual(['no', '45', 'WPA2', 'Nachbar:WLAN'])
  })

  test('an empty field is preserved, so security stays positional', () => {
    expect(splitTerse('no:88::Open')).toEqual(['no', '88', '', 'Open'])
  })
})

describe('network list', () => {
  test('a scan becomes the sorted network list', () => {
    const networks = networksOf(SCAN, new Set(['CoffeeBar Guest']))

    expect(networks.map((network) => network.ssid)).toEqual([
      'INFINITUM3942',
      'CoffeeBar Guest',
      'Nachbar:WLAN',
    ])
    expect(networks[0].active).toBe(true)
    expect(networks[0].signal).toBe(72)
  })

  test('an empty security field means an open network', () => {
    const open = networksOf(SCAN, new Set()).find((network) => network.ssid === 'CoffeeBar Guest')

    expect(open?.secured).toBe(false)
    expect(networksOf(SCAN, new Set())[0].secured).toBe(true)
  })

  test('a saved profile marks its network', () => {
    const networks = networksOf(SCAN, new Set(['CoffeeBar Guest']))

    expect(networks.find((network) => network.ssid === 'CoffeeBar Guest')?.saved).toBe(true)
    expect(networks.find((network) => network.ssid === 'Nachbar:WLAN')?.saved).toBe(false)
  })

  // The same SSID on two access points is one entry in the panel; the weaker
  // sighting must not hide that the machine is connected.
  test('duplicate SSIDs collapse to the strongest and keep the active flag', () => {
    const networks = networksOf(SCAN, new Set())
    const duplicated = networks.filter((network) => network.ssid === 'INFINITUM3942')

    expect(duplicated).toHaveLength(1)
    expect(duplicated[0].signal).toBe(72)
    expect(duplicated[0].active).toBe(true)
  })

  test('an active entry weaker than its twin still reports connected', () => {
    const listing = ['no:88:WPA2:Roaming', 'yes:20:WPA2:Roaming'].join('\n')

    expect(networksOf(listing, new Set())[0].signal).toBe(88)
    expect(networksOf(listing, new Set())[0].active).toBe(true)
  })

  test('a blank SSID is dropped rather than listed as an empty row', () => {
    expect(networksOf('no:60:WPA2:', new Set())).toHaveLength(0)
  })
})

describe('saved profiles', () => {
  test('only wireless connection profiles count as saved', () => {
    const shown = ['Home:802-11-wireless', 'Wired connection 1:802-3-ethernet'].join('\n')

    expect(savedNamesOf(shown)).toEqual(new Set(['Home']))
  })

  test('a profile name containing a colon survives the split', () => {
    expect(savedNamesOf('Guest\\:5G:802-11-wireless')).toEqual(new Set(['Guest:5G']))
  })
})

describe('connection state', () => {
  test('the active network and its addressing become the retained state', () => {
    const state = stateOf(SCAN, ADDRESSING, 'wlan0', true)

    expect(state.connected).toBe(true)
    expect(state.ssid).toBe('INFINITUM3942')
    expect(state.signal).toBe(72)
    expect(state.secured).toBe(true)
    expect(state.ipv4).toBe('192.168.1.42/24')
    expect(state.gateway).toBe('192.168.1.1')
    expect(state.dns).toEqual(['192.168.1.1', '1.1.1.1'])
    expect(state.device).toBe('wlan0')
  })

  test('a device with nothing connected still reports as available', () => {
    const state = stateOf('no:45:WPA2:Nachbar', '', 'wlan0', true)

    expect(state.available).toBe(true)
    expect(state.connected).toBe(false)
    expect(state.ssid).toBe('')
  })

  test('a disabled radio is available but off', () => {
    expect(stateOf('', '', 'wlan0', false).enabled).toBe(false)
    expect(stateOf('', '', 'wlan0', false).available).toBe(true)
  })

  // nmcli prints "--" for an address it has no value for; that is not a gateway.
  test('a placeholder gateway is left empty', () => {
    expect(addressingOf('IP4.GATEWAY:--').gateway).toBe('')
  })
})

describe('device discovery', () => {
  test('the first wifi device is the one the panel drives', () => {
    const devices = ['eno1:ethernet', 'wlan0:wifi', 'lo:loopback'].join('\n')

    expect(wifiDeviceOf(devices)).toBe('wlan0')
  })

  test('a wired-only host has no wifi device', () => {
    expect(wifiDeviceOf('eno1:ethernet\nlo:loopback')).toBe('')
  })
})
