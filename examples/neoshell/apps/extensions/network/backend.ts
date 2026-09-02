import type { Context, Plugin } from '@neoworks/extension-system'
import { requireService } from '../lib/services.js'
import { registerFunction, RetainedTopics } from '../lib/bus.js'
import type { BusService } from '../lib/bus.js'
import { output, run, splitTerse, watchLines } from '../lib/proc.js'

// network: Wi-Fi state and control over nmcli.
//
//   network.state     {available, enabled, connected, ssid, signal, secured,
//                      device, ipv4, gateway, dns}
//   network.networks  [{ssid, signal, secured, active, saved}]
//
//   network:scan       {}                 → {ok}
//   network:connect    {ssid, password?}  → {ok} | {error}
//   network:disconnect {}                 → {ok} | {error}
//   network:forget     {ssid}             → {ok} | {error}
//   network:enable     {enabled}          → {ok} | {error}
//
// `nmcli monitor` streams every state change, so the topics follow a connect,
// a roam, or an rfkill toggle instead of waiting for a poll. Reads pass
// --rescan no; only network:scan forces the radio to sweep.

export interface NetworkState {
  available: boolean
  enabled: boolean
  connected: boolean
  ssid: string
  signal: number
  secured: boolean
  device: string
  ipv4: string
  gateway: string
  dns: string[]
}

export interface WifiNetwork {
  ssid: string
  signal: number
  secured: boolean
  active: boolean
  saved: boolean
}

interface ConnectRequest {
  ssid?: unknown
  password?: unknown
}

// nmcli reports a fresh state before the new address is actually assigned, so
// a change is re-read once more after this delay.
const SETTLE_MS = 400
const REFRESH_DEBOUNCE_MS = 250

const networkExtension: Plugin.Object = {
  name: 'network',
  inject: ['bus'],
  apply(context) {
    const bus = requireService<BusService>(context, 'bus')
    const topics = new RetainedTopics(bus)
    context.effect(() => () => topics.withdrawAll())
    const publisher = new NetworkPublisher(topics)
    context.effect(() => publisher.start())
    registerCommands(context, bus, publisher)
  },
}

export default networkExtension

function registerCommands(context: Context, bus: BusService, publisher: NetworkPublisher): void {
  registerFunction(context, bus, 'network:scan', () => publisher.scan())
  registerFunction(context, bus, 'network:connect', (data) => publisher.connect(data))
  registerFunction(context, bus, 'network:disconnect', () => publisher.disconnect())
  registerFunction(context, bus, 'network:forget', (data) => publisher.forget(data))
  registerFunction(context, bus, 'network:enable', (data) => publisher.enable(data))
}

class NetworkPublisher {
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

  // Every refresh is serialized: nmcli reads are several subprocesses deep and
  // two overlapping passes can retain the topics out of order.
  refresh(): Promise<void> {
    this.queue = this.queue.then(() => this.publishOnce()).catch(logRefreshError)
    return this.queue
  }

  async scan(): Promise<unknown> {
    const result = await run(['nmcli', 'device', 'wifi', 'rescan'])
    await this.refresh()
    return replyOf(result)
  }

  async connect(data: unknown): Promise<unknown> {
    const request = data as ConnectRequest
    if (typeof request.ssid !== 'string' || request.ssid === '') {
      return { error: 'ssid is required' }
    }
    const result = await run(connectCommand(request.ssid, passwordOf(request)))
    await this.settleAndRefresh()
    return replyOf(result)
  }

  async disconnect(): Promise<unknown> {
    const device = await wifiDevice()
    if (device === '') {
      return { error: 'no Wi-Fi device' }
    }
    const result = await run(['nmcli', 'device', 'disconnect', device])
    await this.settleAndRefresh()
    return replyOf(result)
  }

  async forget(data: unknown): Promise<unknown> {
    const ssid = (data as ConnectRequest).ssid
    if (typeof ssid !== 'string' || ssid === '') {
      return { error: 'ssid is required' }
    }
    const result = await run(['nmcli', 'connection', 'delete', 'id', ssid])
    await this.settleAndRefresh()
    return replyOf(result)
  }

  async enable(data: unknown): Promise<unknown> {
    const enabled = (data as { enabled?: unknown }).enabled === true
    const result = await run(['nmcli', 'radio', 'wifi', radioArgument(enabled)])
    await this.settleAndRefresh()
    return replyOf(result)
  }

  private async settleAndRefresh(): Promise<void> {
    await this.refresh()
    await delay(SETTLE_MS)
    await this.refresh()
  }

  private async publishOnce(): Promise<void> {
    const device = await wifiDevice()
    const networks = await readNetworks()
    this.topics.set('network.state', await readState(device))
    this.topics.set('network.networks', networks)
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

function connectCommand(ssid: string, password: string): string[] {
  const base = ['nmcli', 'device', 'wifi', 'connect', ssid]
  if (password === '') {
    return base
  }
  return [...base, 'password', password]
}

function passwordOf(request: ConnectRequest): string {
  if (typeof request.password !== 'string') {
    return ''
  }
  return request.password
}

function radioArgument(enabled: boolean): string {
  if (enabled) {
    return 'on'
  }
  return 'off'
}

// nmcli writes its diagnostics to stderr and they are the only thing that
// distinguishes a wrong password from a missing access point, so a failure
// carries the message through to the panel verbatim.
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

async function wifiDevice(): Promise<string> {
  const listing = await output(['nmcli', '-t', '-f', 'DEVICE,TYPE', 'device'])
  return wifiDeviceOf(listing)
}

export function wifiDeviceOf(listing: string): string {
  for (const line of nonEmptyLines(listing)) {
    const fields = splitTerse(line)
    if (fields[1] === 'wifi') {
      return fields[0]
    }
  }
  return ''
}

async function readState(device: string): Promise<NetworkState> {
  const enabled = (await output(['nmcli', 'radio', 'wifi'])) === 'enabled'
  if (device === '') {
    return { ...emptyState(), enabled }
  }
  const listing = await output([
    'nmcli',
    '-t',
    '-f',
    'ACTIVE,SIGNAL,SECURITY,SSID',
    'device',
    'wifi',
    'list',
    '--rescan',
    'no',
  ])
  const addressing = await output(['nmcli', '-t', '-f', 'IP4', 'device', 'show', device])
  return stateOf(listing, addressing, device, enabled)
}

export function stateOf(
  listing: string,
  addressing: string,
  device: string,
  enabled: boolean,
): NetworkState {
  const active = activeNetworkOf(listing)
  const details = addressingOf(addressing)
  if (active === null) {
    return { ...emptyState(), available: true, enabled, device, ...details }
  }
  return {
    available: true,
    enabled,
    connected: true,
    ssid: active.ssid,
    signal: active.signal,
    secured: active.secured,
    device,
    ...details,
  }
}

function emptyState(): NetworkState {
  return {
    available: false,
    enabled: false,
    connected: false,
    ssid: '',
    signal: 0,
    secured: false,
    device: '',
    ipv4: '',
    gateway: '',
    dns: [],
  }
}

function activeNetworkOf(listing: string): WifiNetwork | null {
  for (const network of parseNetworks(listing)) {
    if (network.active) {
      return network
    }
  }
  return null
}

// `nmcli -t -f IP4 device show` prints one "IP4.<KEY>:<value>" per line, with
// DNS servers numbered (IP4.DNS[1], IP4.DNS[2], …).
export function addressingOf(
  showOutput: string,
): { ipv4: string; gateway: string; dns: string[] } {
  const details = { ipv4: '', gateway: '', dns: [] as string[] }
  for (const line of nonEmptyLines(showOutput)) {
    applyAddressingField(details, line)
  }
  return details
}

function applyAddressingField(
  details: { ipv4: string; gateway: string; dns: string[] },
  line: string,
): void {
  const fields = splitTerse(line)
  const key = fields[0]
  const value = fields.slice(1).join(':')
  if (key.startsWith('IP4.ADDRESS') && details.ipv4 === '') {
    details.ipv4 = value
  }
  if (key === 'IP4.GATEWAY' && value !== '--') {
    details.gateway = value
  }
  if (key.startsWith('IP4.DNS') && value !== '') {
    details.dns.push(value)
  }
}

async function readNetworks(): Promise<WifiNetwork[]> {
  const listing = await output([
    'nmcli',
    '-t',
    '-f',
    'ACTIVE,SIGNAL,SECURITY,SSID',
    'device',
    'wifi',
    'list',
    '--rescan',
    'no',
  ])
  const connections = await output(['nmcli', '-t', '-f', 'NAME,TYPE', 'connection', 'show'])
  return networksOf(listing, savedNamesOf(connections))
}

// SSID is requested last so a colon inside it cannot shift the other fields.
// The same SSID broadcast by several access points collapses to its strongest
// sighting, and the connected one always wins.
export function networksOf(listing: string, saved: Set<string>): WifiNetwork[] {
  const strongest = new Map<string, WifiNetwork>()
  for (const network of parseNetworks(listing)) {
    mergeNetwork(strongest, { ...network, saved: saved.has(network.ssid) })
  }
  return [...strongest.values()].sort(compareNetworks)
}

function parseNetworks(listing: string): WifiNetwork[] {
  const networks: WifiNetwork[] = []
  for (const line of nonEmptyLines(listing)) {
    appendNetwork(networks, splitTerse(line))
  }
  return networks
}

function appendNetwork(networks: WifiNetwork[], fields: string[]): void {
  if (fields.length < 4) {
    return
  }
  const ssid = fields.slice(3).join(':')
  if (ssid === '') {
    return
  }
  networks.push({
    ssid,
    signal: signalOf(fields[1]),
    secured: fields[2] !== '',
    active: fields[0] === 'yes',
    saved: false,
  })
}

function signalOf(raw: string): number {
  const signal = Number.parseInt(raw, 10)
  if (Number.isNaN(signal)) {
    return 0
  }
  return signal
}

function mergeNetwork(strongest: Map<string, WifiNetwork>, network: WifiNetwork): void {
  const existing = strongest.get(network.ssid)
  if (existing === undefined) {
    strongest.set(network.ssid, network)
    return
  }
  const active = existing.active || network.active
  if (network.signal > existing.signal) {
    strongest.set(network.ssid, { ...network, active })
    return
  }
  strongest.set(network.ssid, { ...existing, active })
}

function compareNetworks(left: WifiNetwork, right: WifiNetwork): number {
  if (left.active !== right.active) {
    return Number(right.active) - Number(left.active)
  }
  return right.signal - left.signal
}

export function savedNamesOf(connections: string): Set<string> {
  const names = new Set<string>()
  for (const line of nonEmptyLines(connections)) {
    addSavedName(names, splitTerse(line))
  }
  return names
}

function addSavedName(names: Set<string>, fields: string[]): void {
  if (fields.length < 2) {
    return
  }
  const type = fields[fields.length - 1]
  if (!type.includes('wireless')) {
    return
  }
  names.add(fields.slice(0, -1).join(':'))
}

function nonEmptyLines(text: string): string[] {
  return text.split('\n').filter((line) => line.trim() !== '')
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function logRefreshError(error: unknown): void {
  console.error('network: refresh failed:', error)
}
