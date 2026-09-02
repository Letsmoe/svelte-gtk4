import type { Context, Plugin } from '@neoworks/extension-system'
import { requireService } from '../../lib/services.js'
import { registerFunction } from '../../lib/bus.js'
import type { BusService } from '../../lib/bus.js'
import { output, run, watchLines } from '../../gjs/proc.js'
import { joinPath, readDirectory, readTextFile } from '../../gjs/fs.js'

// system: battery, audio and backlight state as retained bus topics.
//
//   system.battery     {percent, charging, status}   30s poll over /sys
//   system.volume      {volume, muted}               wpctl, re-read on pactl events
//   system.brightness  {percent, available}          brightnessctl, 10s poll
//
//   system:setVolume      {volume}   → {ok} | {error}
//   system:setMuted       {muted}    → {ok} | {error}
//   system:setBrightness  {percent}  → {ok} | {error}
//   system:power          {action}   → {ok} | {error}

interface SystemConfig {
  batteryDir?: string
  batteryPollMs?: number
  volume?: boolean
  brightness?: boolean
}

interface BatteryState {
  percent: number
  charging: boolean
  status: string
}

interface VolumeState {
  volume: number
  muted: boolean
}

interface BrightnessState {
  percent: number
  available: boolean
}

interface ResolvedConfig {
  batteryDir: string
  batteryPollMs: number
  volume: boolean
  brightness: boolean
}

const BRIGHTNESS_POLL_MS = 10_000

// Session actions the power menu may ask for, mapped to the tool that performs
// them. Anything not listed is refused rather than shelled out.
const POWER_COMMANDS: Record<string, string[]> = {
  poweroff: ['systemctl', 'poweroff'],
  reboot: ['systemctl', 'reboot'],
  suspend: ['systemctl', 'suspend'],
  lock: ['loginctl', 'lock-session'],
  // The compositor owns the session here, so logging out is its exit, not a
  // loginctl terminate-session that would need the session id.
  logout: ['hyprctl', 'dispatch', 'exit'],
}

const systemExtension: Plugin.Object<SystemConfig | undefined> = {
  name: 'system',
  inject: ['bus'],
  apply(context, config) {
    const bus = requireService<BusService>(context, 'bus')
    const options = resolveConfig(config)
    startBatteryPoller(context, bus, options)
    if (options.volume) {
      startVolumeWatcher(context, bus)
    }
    if (options.brightness) {
      startBrightnessPoller(context, bus)
    }
    registerCommands(context, bus)
  },
}

export default systemExtension

function registerCommands(context: Context, bus: BusService): void {
  registerFunction(context, bus, 'system:setVolume', (data) => setVolume(data))
  registerFunction(context, bus, 'system:setMuted', (data) => setMuted(data))
  registerFunction(context, bus, 'system:setBrightness', (data) => setBrightness(data))
  registerFunction(context, bus, 'system:power', (data) => runPowerAction(data))
}

async function setVolume(data: unknown): Promise<unknown> {
  const volume = percentOf(data, 'volume')
  if (volume < 0) {
    return { error: 'volume must be 0..100' }
  }
  return replyOf(await run(['wpctl', 'set-volume', '@DEFAULT_AUDIO_SINK@', `${volume}%`]))
}

async function setMuted(data: unknown): Promise<unknown> {
  const muted = (data as { muted?: unknown }).muted === true
  return replyOf(await run(['wpctl', 'set-mute', '@DEFAULT_AUDIO_SINK@', muteArgument(muted)]))
}

async function setBrightness(data: unknown): Promise<unknown> {
  const percent = percentOf(data, 'percent')
  if (percent < 0) {
    return { error: 'percent must be 0..100' }
  }
  return replyOf(await run(['brightnessctl', 'set', `${percent}%`]))
}

async function runPowerAction(data: unknown): Promise<unknown> {
  const action = (data as { action?: unknown }).action
  if (typeof action !== 'string') {
    return { error: 'action is required' }
  }
  const command = POWER_COMMANDS[action]
  if (command === undefined) {
    return { error: `unknown power action "${action}"` }
  }
  return replyOf(await run(command))
}

function muteArgument(muted: boolean): string {
  if (muted) {
    return '1'
  }
  return '0'
}

// Returns -1 for anything that is not a percentage, so callers reject with one
// guard instead of unpacking a union.
function percentOf(data: unknown, key: string): number {
  const raw = (data as Record<string, unknown>)[key]
  if (typeof raw !== 'number' || Number.isNaN(raw)) {
    return -1
  }
  if (raw < 0 || raw > 100) {
    return -1
  }
  return Math.round(raw)
}

function replyOf(result: { ok: boolean; stderr: string }): unknown {
  if (result.ok) {
    return { ok: true }
  }
  if (result.stderr === '') {
    return { error: 'command failed' }
  }
  return { error: result.stderr }
}

function resolveConfig(config: SystemConfig | undefined): ResolvedConfig {
  const resolved: ResolvedConfig = {
    batteryDir: '/sys/class/power_supply',
    batteryPollMs: 30_000,
    volume: true,
    brightness: true,
  }
  if (config === undefined) {
    return resolved
  }
  if (config.brightness !== undefined) {
    resolved.brightness = config.brightness
  }
  if (config.batteryDir !== undefined) {
    resolved.batteryDir = config.batteryDir
  }
  if (config.batteryPollMs !== undefined) {
    resolved.batteryPollMs = config.batteryPollMs
  }
  if (config.volume !== undefined) {
    resolved.volume = config.volume
  }
  return resolved
}

function startBatteryPoller(context: Context, bus: BusService, options: ResolvedConfig): void {
  let withdraw: (() => void) | null = null
  const publish = () => {
    const state = readBattery(options.batteryDir)
    if (state === null) {
      return
    }
    if (withdraw !== null) {
      withdraw()
    }
    withdraw = bus.retain('system.battery', state)
  }
  context.effect(() => {
    publish()
    const timer = setInterval(publish, options.batteryPollMs)
    return () => {
      clearInterval(timer)
      withdrawIfSet(withdraw)
    }
  })
}

function startVolumeWatcher(context: Context, bus: BusService): void {
  let withdraw: (() => void) | null = null
  const publish = async () => {
    const state = await readVolume()
    if (state === null) {
      return
    }
    if (withdraw !== null) {
      withdraw()
    }
    withdraw = bus.retain('system.volume', state)
  }
  context.effect(() => {
    void publish()
    const stopWatching = watchAudioEvents(publish)
    return () => {
      stopWatching()
      withdrawIfSet(withdraw)
    }
  })
}

// Backlight changes come from keys the compositor handles and from this
// extension's own setter; neither is observable without udev, so a short poll
// keeps the slider honest.
function startBrightnessPoller(context: Context, bus: BusService): void {
  let withdraw: (() => void) | null = null
  const publish = async () => {
    const state = await readBrightness()
    if (withdraw !== null) {
      withdraw()
    }
    withdraw = bus.retain('system.brightness', state)
  }
  context.effect(() => {
    void publish()
    const timer = setInterval(() => void publish(), BRIGHTNESS_POLL_MS)
    return () => {
      clearInterval(timer)
      withdrawIfSet(withdraw)
    }
  })
}

async function readBrightness(): Promise<BrightnessState> {
  return parseBrightness(await output(['brightnessctl', '--machine-readable']))
}

// brightnessctl -m prints "device,class,current,percent%,max".
export function parseBrightness(machineOutput: string): BrightnessState {
  const fields = machineOutput.split('\n')[0].split(',')
  if (fields.length < 4) {
    return { percent: 0, available: false }
  }
  const percent = Number.parseInt(fields[3].replace('%', ''), 10)
  if (Number.isNaN(percent)) {
    return { percent: 0, available: false }
  }
  return { percent, available: true }
}

function withdrawIfSet(withdraw: (() => void) | null): void {
  if (withdraw !== null) {
    withdraw()
  }
}

function readBattery(dir: string): BatteryState | null {
  const batteryPath = findBattery(dir)
  if (batteryPath === null) {
    return null
  }
  const capacityRaw = readTextFile(joinPath(batteryPath, 'capacity'))
  if (capacityRaw === null) {
    return null
  }
  const statusRaw = readTextFile(joinPath(batteryPath, 'status'))
  let status = ''
  if (statusRaw !== null) {
    status = statusRaw.trim()
  }
  return {
    percent: Number.parseInt(capacityRaw.trim(), 10),
    charging: status === 'Charging',
    status,
  }
}

function findBattery(dir: string): string | null {
  for (const entry of readDirectory(dir)) {
    if (entry.startsWith('BAT')) {
      return joinPath(dir, entry)
    }
  }
  return null
}

// watchAudioEvents re-reads the volume on every pactl sink event, so changes
// land instantly instead of on a poll. Missing pactl degrades to the single
// read at startup.
function watchAudioEvents(publish: () => Promise<void>): () => void {
  return watchLines(['pactl', 'subscribe'], (line) => {
    if (line.includes('sink')) {
      void publish()
    }
  })
}

async function readVolume(): Promise<VolumeState | null> {
  const raw = await output(['wpctl', 'get-volume', '@DEFAULT_AUDIO_SINK@'])
  if (raw === '') {
    return null
  }
  return parseVolume(raw)
}

// wpctl prints "Volume: 0.75" or "Volume: 0.75 [MUTED]".
export function parseVolume(text: string): VolumeState | null {
  const fields = text.trim().split(/\s+/)
  if (fields.length < 2) {
    return null
  }
  const level = Number.parseFloat(fields[1])
  if (Number.isNaN(level)) {
    return null
  }
  return { volume: Math.round(level * 100), muted: text.includes('[MUTED]') }
}
