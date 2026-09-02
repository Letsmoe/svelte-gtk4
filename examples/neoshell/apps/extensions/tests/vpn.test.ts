import { describe, expect, test } from 'bun:test'
import { addressOf, preferredName, profilesOf, stateOf } from '../vpn/backend.js'

// Verbatim `nmcli -t -f NAME,TYPE,ACTIVE,DEVICE connection show` output: every
// connection on the machine, VPN or not, with a literal colon in a profile
// name escaped as "\:".
const CONNECTIONS = [
  'Wired connection 1:802-3-ethernet:yes:eno1',
  'Work\\: Berlin:vpn:yes:eno1',
  'Moritz:802-11-wireless:yes:wlan0',
  'homelab:wireguard:no:--',
  'docker0:bridge:yes:docker0',
].join('\n')

const OFFLINE = [
  'Wired connection 1:802-3-ethernet:yes:eno1',
  'homelab:wireguard:no:--',
  'Work\\: Berlin:vpn:no:--',
].join('\n')

const ADDRESSING = ['IP4.ADDRESS[1]:10.8.0.6/24', 'IP4.ADDRESS[2]:10.8.1.6/24'].join('\n')

describe('profile list', () => {
  test('only vpn and wireguard connections are profiles', () => {
    expect(profilesOf(CONNECTIONS).map((profile) => profile.name)).toEqual([
      'Work: Berlin',
      'homelab',
    ])
  })

  test('the active profile sorts first, the rest by name', () => {
    expect(profilesOf(OFFLINE).map((profile) => profile.name)).toEqual(['homelab', 'Work: Berlin'])
  })

  test('a profile that is not up carries no device', () => {
    const profiles = profilesOf(CONNECTIONS)

    expect(profiles[0]).toMatchObject({ type: 'vpn', active: true, device: 'eno1' })
    expect(profiles[1]).toMatchObject({ type: 'wireguard', active: false, device: '' })
  })
})

describe('vpn state', () => {
  test('the active profile becomes the connected state', () => {
    const state = stateOf(profilesOf(CONNECTIONS), ADDRESSING)

    expect(state.connected).toBe(true)
    expect(state.name).toBe('Work: Berlin')
    expect(state.ipv4).toBe('10.8.0.6/24')
  })

  // The indicator draws nothing when available is false, so "no profile
  // installed" and "profile installed but down" must not collapse.
  test('installed profiles stay available while none is up', () => {
    const state = stateOf(profilesOf(OFFLINE), '')

    expect(state.available).toBe(true)
    expect(state.connected).toBe(false)
    expect(state.name).toBe('')
  })

  test('a machine with no vpn profile is unavailable', () => {
    expect(stateOf([], '').available).toBe(false)
  })
})

describe('address parsing', () => {
  test('the first IP4.ADDRESS is the tunnel address', () => {
    expect(addressOf(ADDRESSING)).toBe('10.8.0.6/24')
  })

  test('a profile that reports no address yields none', () => {
    expect(addressOf('')).toBe('')
  })
})

describe('toggle target', () => {
  test('an unnamed toggle brings up the first profile', () => {
    expect(preferredName(profilesOf(OFFLINE), '')).toBe('homelab')
  })

  test('a named toggle keeps the name it was given', () => {
    expect(preferredName(profilesOf(OFFLINE), 'Work: Berlin')).toBe('Work: Berlin')
  })

  test('no profile means nothing to bring up', () => {
    expect(preferredName([], '')).toBe('')
  })
})
