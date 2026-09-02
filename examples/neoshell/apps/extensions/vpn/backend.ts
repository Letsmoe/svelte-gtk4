import type { Context, Plugin } from '@neoworks/extension-system'
import { requireService } from '../lib/services.js'
import { registerFunction, RetainedTopics } from '../lib/bus.js'
import type { BusService } from '../lib/bus.js'
import { output, run, splitTerse, watchLines } from '../lib/proc.js'

// vpn: the machine's NetworkManager VPN profiles — the imported ones ("vpn":
// OpenVPN, IKEv2, …) and the native WireGuard ones — as retained topics.
//
//   vpn.state     {available, connected, name, type, device, ipv4}
//   vpn.profiles  [{name, type, active, device}]
//
//   vpn:connect    {name}   → {ok} | {error}
//   vpn:disconnect {name?}  → {ok} | {error}
//   vpn:toggle     {name?}  → {ok} | {error}
//
// available is false on a machine with no VPN profile at all, which is what
// the bar indicator reads to draw nothing rather than an off switch for
// something that does not exist.
//
// `nmcli monitor` streams every state change, so the topics follow a tunnel
// coming up or dropping instead of waiting for a poll.

export interface VpnProfile {
  name: string
  type: string
  active: boolean
  device: string
}

export interface VpnState {
  available: boolean
  connected: boolean
  name: string
  type: string
  device: string
  ipv4: string
}

// The connection types that are a VPN. NetworkManager keeps imported tunnels
// under one "vpn" type and WireGuard as a link type of its own.
const VPN_TYPES = new Set(['vpn', 'wireguard'])

// nmcli reports the profile as activated before its address is assigned, so a
// change is re-read once more after this delay.
const SETTLE_MS = 400
const REFRESH_DEBOUNCE_MS = 250

const vpnExtension: Plugin.Object = {
  name: 'vpn',
  inject: ['bus'],
  apply(context) {
    const bus = requireService<BusService>(context, 'bus')
    const topics = new RetainedTopics(bus)
    context.effect(() => () => topics.withdrawAll())
    const publisher = new VpnPublisher(topics)
    context.effect(() => publisher.start())
    registerCommands(context, bus, publisher)
  },
}

export default vpnExtension

function registerCommands(context: Context, bus: BusService, publisher: VpnPublisher): void {
  registerFunction(context, bus, 'vpn:connect', (data) => publisher.connect(data))
  registerFunction(context, bus, 'vpn:disconnect', (data) => publisher.disconnect(data))
  registerFunction(context, bus, 'vpn:toggle', (data) => publisher.toggle(data))
}

class VpnPublisher {
  private readonly topics: RetainedTopics
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private queue: Promise<void> = Promise.resolve()

  constructor(topics: RetainedTopics) {
    this.topics = topics
  }

  start(): () => void {
    this.refreshSoon()
    const stopMonitor = watchLines(['nmcli', 'monitor'], () => this.refreshSoon())
    return () => {
      stopMonitor()
      this.cancelPendingRefresh()
    }
  }

  // Every refresh is serialized: a read is several nmcli calls deep and two
  // overlapping passes can retain the topics out of order.
  refresh(): Promise<void> {
    this.queue = this.queue.then(() => this.publishOnce()).catch(logRefreshError)
    return this.queue
  }

  async connect(data: unknown): Promise<unknown> {
    const name = nameOf(data)
    if (name === '') {
      return { error: 'name is required' }
    }
    const result = await run(['nmcli', 'connection', 'up', 'id', name])
    await this.settleAndRefresh()
    return replyOf(result)
  }

  // No name means the tunnel that is up, so the bar can hang a single button
  // off this without tracking which profile it started.
  async disconnect(data: unknown): Promise<unknown> {
    const name = await this.resolveActiveName(nameOf(data))
    if (name === '') {
      return { error: 'no active VPN' }
    }
    const result = await run(['nmcli', 'connection', 'down', 'id', name])
    await this.settleAndRefresh()
    return replyOf(result)
  }

  async toggle(data: unknown): Promise<unknown> {
    const profiles = await readProfiles()
    const active = activeProfileOf(profiles)
    if (active !== null) {
      return this.disconnect({ name: active.name })
    }
    return this.connect({ name: preferredName(profiles, nameOf(data)) })
  }

  private async resolveActiveName(requested: string): Promise<string> {
    if (requested !== '') {
      return requested
    }
    const active = activeProfileOf(await readProfiles())
    if (active === null) {
      return ''
    }
    return active.name
  }

  private async settleAndRefresh(): Promise<void> {
    await this.refresh()
    await delay(SETTLE_MS)
    await this.refresh()
  }

  private async publishOnce(): Promise<void> {
    const profiles = await readProfiles()
    this.topics.set('vpn.profiles', profiles)
    this.topics.set('vpn.state', await readState(profiles))
  }

  // nmcli monitor emits a burst of lines per transition; one refresh covers
  // the whole burst.
  private refreshSoon(): void {
    if (this.refreshTimer !== null) {
      return
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      void this.refresh()
    }, REFRESH_DEBOUNCE_MS)
  }

  private cancelPendingRefresh(): void {
    if (this.refreshTimer === null) {
      return
    }
    clearTimeout(this.refreshTimer)
    this.refreshTimer = null
  }
}

async function readProfiles(): Promise<VpnProfile[]> {
  const listing = await output([
    'nmcli',
    '-t',
    '-f',
    'NAME,TYPE,ACTIVE,DEVICE',
    'connection',
    'show',
  ])
  return profilesOf(listing)
}

async function readState(profiles: VpnProfile[]): Promise<VpnState> {
  const active = activeProfileOf(profiles)
  if (active === null) {
    return stateOf(profiles, '')
  }
  const addressing = await output([
    'nmcli',
    '-t',
    '-f',
    'IP4.ADDRESS',
    'connection',
    'show',
    active.name,
  ])
  return stateOf(profiles, addressing)
}

// NAME is requested first and every field is unescaped by splitTerse, so a
// profile called "Work: Berlin" stays one field.
export function profilesOf(listing: string): VpnProfile[] {
  const profiles: VpnProfile[] = []
  for (const line of nonEmptyLines(listing)) {
    appendProfile(profiles, splitTerse(line))
  }
  return profiles.sort(compareProfiles)
}

function appendProfile(profiles: VpnProfile[], fields: string[]): void {
  if (fields.length < 4 || !VPN_TYPES.has(fields[1])) {
    return
  }
  profiles.push({
    name: fields[0],
    type: fields[1],
    active: fields[2] === 'yes',
    device: deviceOf(fields[3]),
  })
}

// nmcli prints "--" for the device of a profile that is not up.
function deviceOf(field: string): string {
  if (field === '--') {
    return ''
  }
  return field
}

function compareProfiles(left: VpnProfile, right: VpnProfile): number {
  if (left.active !== right.active) {
    return Number(right.active) - Number(left.active)
  }
  return left.name.localeCompare(right.name)
}

export function stateOf(profiles: VpnProfile[], addressing: string): VpnState {
  const active = activeProfileOf(profiles)
  if (active === null) {
    return {
      available: profiles.length > 0,
      connected: false,
      name: '',
      type: '',
      device: '',
      ipv4: '',
    }
  }
  return {
    available: true,
    connected: true,
    name: active.name,
    type: active.type,
    device: active.device,
    ipv4: addressOf(addressing),
  }
}

export function activeProfileOf(profiles: VpnProfile[]): VpnProfile | null {
  for (const profile of profiles) {
    if (profile.active) {
      return profile
    }
  }
  return null
}

// `nmcli -t -f IP4.ADDRESS connection show <name>` prints one
// "IP4.ADDRESS[n]:<address>/<prefix>" per address; the tunnel's first one is
// what the indicator shows.
export function addressOf(showOutput: string): string {
  for (const line of nonEmptyLines(showOutput)) {
    const address = addressFieldOf(splitTerse(line))
    if (address !== '') {
      return address
    }
  }
  return ''
}

function addressFieldOf(fields: string[]): string {
  if (fields.length < 2 || !fields[0].startsWith('IP4.ADDRESS')) {
    return ''
  }
  return fields.slice(1).join(':')
}

// Which profile a toggle brings up when the caller named none: the requested
// one if it exists, otherwise the first, since the list is sorted by name.
export function preferredName(profiles: VpnProfile[], requested: string): string {
  if (requested !== '') {
    return requested
  }
  if (profiles.length === 0) {
    return ''
  }
  return profiles[0].name
}

function nameOf(data: unknown): string {
  if (typeof data !== 'object' || data === null) {
    return ''
  }
  const name = (data as { name?: unknown }).name
  if (typeof name !== 'string') {
    return ''
  }
  return name
}

// nmcli writes its diagnostics to stderr and they are the only thing that
// distinguishes a missing secret from an unreachable server, so a failure
// carries the message through to the caller verbatim.
function replyOf(result: { ok: boolean; stderr: string; stdout: string }): unknown {
  if (result.ok) {
    return { ok: true }
  }
  return { error: failureMessageOf(result) }
}

function failureMessageOf(result: { stderr: string; stdout: string }): string {
  const message = firstNonEmpty(result.stderr, result.stdout)
  if (message === '') {
    return 'nmcli failed'
  }
  return message.replace(/^Error:\s*/, '')
}

function firstNonEmpty(primary: string, fallback: string): string {
  if (primary !== '') {
    return primary
  }
  return fallback
}

function nonEmptyLines(text: string): string[] {
  return text.split('\n').filter((line) => line.trim() !== '')
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function logRefreshError(error: unknown): void {
  console.error('vpn: refresh failed:', error)
}
