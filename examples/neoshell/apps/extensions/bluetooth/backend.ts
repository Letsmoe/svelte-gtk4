import type { Context, Plugin } from '@neoworks/extension-system'
import { requireService } from '../lib/services.js'
import { registerFunction, RetainedTopics } from '../lib/bus.js'
import type { BusService } from '../lib/bus.js'
import { output, run } from '../lib/proc.js'
import { startPolling } from '../lib/poll.js'

// bluetooth: adapter state and device control over bluetoothctl.
//
//   bluetooth.state    {available, powered, discovering, adapter}
//   bluetooth.devices  [{mac, name, connected, paired, trusted, icon, battery}]
//
//   bluetooth:power      {powered}  → {ok} | {error}
//   bluetooth:scan       {}         → {ok}
//   bluetooth:connect    {mac}      → {ok} | {error}
//   bluetooth:disconnect {mac}      → {ok} | {error}
//   bluetooth:pair       {mac}      → {ok} | {error}
//   bluetooth:trust      {mac}      → {ok} | {error}
//   bluetooth:forget     {mac}      → {ok} | {error}
//
// bluetoothctl has no event stream to tail the way nmcli monitor does, so the
// state is polled and every command refreshes on completion — a device that
// appears mid-scan shows up within one interval.

export interface BluetoothState {
  available: boolean
  powered: boolean
  discovering: boolean
  adapter: string
}

export interface BluetoothDevice {
  mac: string
  name: string
  connected: boolean
  paired: boolean
  trusted: boolean
  icon: string
  battery: number
}

const POLL_MS = 5_000
const SCAN_SECONDS = '10'
const NO_BATTERY = -1

const bluetoothExtension: Plugin.Object = {
  name: 'bluetooth',
  inject: ['bus'],
  apply(context, _config) {
    const bus = requireService<BusService>(context, 'bus')
    const topics = new RetainedTopics(bus)
    context.effect(() => () => topics.withdrawAll())
    const publisher = new BluetoothPublisher(topics)
    startPolling(context, POLL_MS, () => publisher.refresh())
    registerCommands(context, bus, publisher)
  },
}

export default bluetoothExtension

function registerCommands(context: Context, bus: BusService, publisher: BluetoothPublisher): void {
  registerFunction(context, bus, 'bluetooth:power', (data) => publisher.power(data))
  registerFunction(context, bus, 'bluetooth:scan', () => publisher.scan())
  registerFunction(context, bus, 'bluetooth:connect', (data) => publisher.act('connect', data))
  registerFunction(context, bus, 'bluetooth:disconnect', (data) =>
    publisher.act('disconnect', data),
  )
  registerFunction(context, bus, 'bluetooth:pair', (data) => publisher.pair(data))
  registerFunction(context, bus, 'bluetooth:trust', (data) => publisher.act('trust', data))
  registerFunction(context, bus, 'bluetooth:forget', (data) => publisher.act('remove', data))
}

class BluetoothPublisher {
  private readonly topics: RetainedTopics
  private queue: Promise<void> = Promise.resolve()

  constructor(topics: RetainedTopics) {
    this.topics = topics
  }

  refresh(): Promise<void> {
    this.queue = this.queue.then(() => this.publishOnce()).catch(logRefreshError)
    return this.queue
  }

  async power(data: unknown): Promise<unknown> {
    const powered = (data as { powered?: unknown }).powered === true
    const result = await run(['bluetoothctl', 'power', powerArgument(powered)])
    await this.refresh()
    return replyOf(result)
  }

  // Discovery blocks for its whole timeout, so the scan is fired and left to
  // run; the poller picks up devices as they appear.
  async scan(): Promise<unknown> {
    void run(['bluetoothctl', '--timeout', SCAN_SECONDS, 'scan', 'on']).then(() => this.refresh())
    await this.refresh()
    return { ok: true }
  }

  async act(verb: string, data: unknown): Promise<unknown> {
    const mac = macOf(data)
    if (mac === '') {
      return { error: 'mac is required' }
    }
    const result = await run(['bluetoothctl', verb, mac])
    await this.refresh()
    return replyOf(result)
  }

  // Pairing an unknown device fails on most adapters unless it is trusted
  // first, and a paired-but-untrusted device re-prompts on every reconnect.
  async pair(data: unknown): Promise<unknown> {
    const mac = macOf(data)
    if (mac === '') {
      return { error: 'mac is required' }
    }
    const paired = await run(['bluetoothctl', 'pair', mac])
    if (!paired.ok) {
      await this.refresh()
      return replyOf(paired)
    }
    await run(['bluetoothctl', 'trust', mac])
    return this.act('connect', data)
  }

  private async publishOnce(): Promise<void> {
    const state = stateOf(await output(['bluetoothctl', 'show']))
    this.topics.set('bluetooth.state', state)
    this.topics.set('bluetooth.devices', await readDevices(state.powered))
  }
}

async function readDevices(powered: boolean): Promise<BluetoothDevice[]> {
  if (!powered) {
    return []
  }
  const devices = devicesOf(
    await output(['bluetoothctl', 'devices']),
    macsOf(await output(['bluetoothctl', 'devices', 'Connected'])),
    macsOf(await output(['bluetoothctl', 'devices', 'Paired'])),
  )
  return withDeviceDetails(devices)
}

// `bluetoothctl info` costs a subprocess per device, so only connected ones
// are asked — they are the only devices whose icon and battery are shown.
async function withDeviceDetails(devices: BluetoothDevice[]): Promise<BluetoothDevice[]> {
  const detailed: BluetoothDevice[] = []
  for (const device of devices) {
    detailed.push(await withDetails(device))
  }
  return detailed
}

async function withDetails(device: BluetoothDevice): Promise<BluetoothDevice> {
  if (!device.connected) {
    return device
  }
  const info = await output(['bluetoothctl', 'info', device.mac])
  return { ...device, icon: iconOf(info), battery: batteryOf(info), trusted: trustedOf(info) }
}

// `bluetoothctl show` prints "Powered: yes" style lines under the controller.
export function stateOf(showOutput: string): BluetoothState {
  if (showOutput === '') {
    return { available: false, powered: false, discovering: false, adapter: '' }
  }
  return {
    available: true,
    powered: flagOf(showOutput, 'Powered'),
    discovering: flagOf(showOutput, 'Discovering'),
    adapter: fieldOf(showOutput, 'Name'),
  }
}

export function devicesOf(
  listing: string,
  connected: Set<string>,
  paired: Set<string>,
): BluetoothDevice[] {
  const devices: BluetoothDevice[] = []
  for (const line of listing.split('\n')) {
    appendDevice(devices, line, connected, paired)
  }
  return devices.sort(compareDevices)
}

function appendDevice(
  devices: BluetoothDevice[],
  line: string,
  connected: Set<string>,
  paired: Set<string>,
): void {
  const match = line.match(/^Device\s+(\S+)\s+(.+)$/)
  if (match === null) {
    return
  }
  devices.push({
    mac: match[1],
    name: match[2].trim(),
    connected: connected.has(match[1]),
    paired: paired.has(match[1]),
    trusted: false,
    icon: '',
    battery: NO_BATTERY,
  })
}

function compareDevices(left: BluetoothDevice, right: BluetoothDevice): number {
  if (left.connected !== right.connected) {
    return Number(right.connected) - Number(left.connected)
  }
  if (left.paired !== right.paired) {
    return Number(right.paired) - Number(left.paired)
  }
  return left.name.localeCompare(right.name)
}

export function macsOf(listing: string): Set<string> {
  const macs = new Set<string>()
  for (const line of listing.split('\n')) {
    const match = line.match(/^Device\s+(\S+)/)
    if (match !== null) {
      macs.add(match[1])
    }
  }
  return macs
}

// "Battery Percentage: 0x64 (100)" — the decimal in parentheses is the one to
// read; the hex prefix is the raw characteristic value.
export function batteryOf(info: string): number {
  const match = info.match(/Battery Percentage:\s*\S+\s*\((\d+)\)/)
  if (match === null) {
    return NO_BATTERY
  }
  return Number.parseInt(match[1], 10)
}

export function iconOf(info: string): string {
  return fieldOf(info, 'Icon')
}

function trustedOf(info: string): boolean {
  return flagOf(info, 'Trusted')
}

function flagOf(text: string, key: string): boolean {
  return fieldOf(text, key) === 'yes'
}

function fieldOf(text: string, key: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith(`${key}:`)) {
      return trimmed.slice(key.length + 1).trim()
    }
  }
  return ''
}

function macOf(data: unknown): string {
  const mac = (data as { mac?: unknown }).mac
  if (typeof mac !== 'string') {
    return ''
  }
  return mac
}

function powerArgument(powered: boolean): string {
  if (powered) {
    return 'on'
  }
  return 'off'
}

function replyOf(result: { ok: boolean; stderr: string; stdout: string }): unknown {
  if (result.ok) {
    return { ok: true }
  }
  return { error: failureMessageOf(result) }
}

// bluetoothctl reports failures on stdout ("Failed to pair: org.bluez.Error…")
// and exits non-zero, so both streams are worth reading before giving up.
function failureMessageOf(result: { stderr: string; stdout: string }): string {
  const lines = `${result.stdout}\n${result.stderr}`.split('\n')
  for (const line of lines) {
    if (line.includes('Failed') || line.includes('Error')) {
      return line.trim()
    }
  }
  return 'bluetoothctl failed'
}

function logRefreshError(error: unknown): void {
  console.error('bluetooth: refresh failed:', error)
}
