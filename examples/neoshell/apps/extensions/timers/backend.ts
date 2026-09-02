import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Plugin } from '@neoworks/extension-system'
import { requireService } from '../lib/services.js'
import { registerFunction } from '../lib/bus.js'
import type { BusService } from '../lib/bus.js'

// timers: countdown timers and time-tracking sessions, moved out of the Go
// core (internal/timers). State persists to XDG data and is a retained bus
// topic; the functions are plain request/reply:
//
//   timers                 retained snapshot {timers, sessions}
//   timer:start            {seconds, label?} → {id} | {error}
//   timer:stop             {id}
//   timer:list             → snapshot
//   track:start            {label} → {id}
//   track:stop             {id?}   stops the given or most recent running one
//
// Expired timers fire a desktop notification via notify-send, best-effort.

interface Timer {
  id: string
  label: string
  endsAt: number
}

interface Session {
  id: string
  label: string
  startedAt: number
  stoppedAt: number
}

interface TimersState {
  timers: Timer[]
  sessions: Session[]
}

interface TimersConfig {
  dataPath?: string
  tickMs?: number
  notify?: boolean
}

const timersExtension: Plugin.Object<TimersConfig | undefined> = {
  name: 'timers',
  inject: ['bus'],
  apply(context, config) {
    const bus = requireService<BusService>(context, 'bus')
    const service = new TimersService(bus, config)
    service.load()
    context.effect(() => service.publishRetained())
    context.effect(() => service.startTicker())
    registerFunction(context, bus, 'timer:start', (data) => service.startTimer(data))
    registerFunction(context, bus, 'timer:stop', (data) => service.stopTimer(data))
    registerFunction(context, bus, 'timer:list', () => service.snapshot())
    registerFunction(context, bus, 'track:start', (data) => service.startTrack(data))
    registerFunction(context, bus, 'track:stop', (data) => service.stopTrack(data))
  },
}

export default timersExtension

class TimersService {
  private state: TimersState = { timers: [], sessions: [] }
  private sequence = 0
  private clearRetained: () => void = () => {}
  private readonly bus: BusService
  private readonly dataPath: string
  private readonly tickMs: number
  private readonly notify: boolean

  constructor(bus: BusService, config: TimersConfig | undefined) {
    this.bus = bus
    this.dataPath = resolveDataPath(config)
    this.tickMs = resolveTickMs(config)
    this.notify = resolveNotify(config)
  }

  load(): void {
    const raw = readTextFile(this.dataPath)
    if (raw === null) {
      return
    }
    const parsed = parseState(raw)
    if (parsed !== null) {
      this.state = parsed
    }
  }

  publishRetained(): () => void {
    this.clearRetained = this.bus.retain('timers', this.snapshot())
    return () => this.clearRetained()
  }

  startTicker(): () => void {
    const ticker = setInterval(() => this.fireExpired(), this.tickMs)
    return () => clearInterval(ticker)
  }

  snapshot(): TimersState {
    return structuredClone(this.state)
  }

  startTimer(data: unknown): unknown {
    const args = data as { seconds?: number; label?: string }
    if (typeof args.seconds !== 'number' || args.seconds <= 0) {
      return { error: 'seconds must be a positive number' }
    }
    const timer: Timer = {
      id: this.nextId(),
      label: labelOf(args.label),
      endsAt: Date.now() + args.seconds * 1000,
    }
    this.state.timers.push(timer)
    this.persistAndPublish()
    return { id: timer.id }
  }

  stopTimer(data: unknown): unknown {
    const args = data as { id?: string }
    if (typeof args.id !== 'string' || args.id === '') {
      return { error: 'id is required' }
    }
    this.state.timers = this.state.timers.filter((timer) => timer.id !== args.id)
    this.persistAndPublish()
    return { ok: true }
  }

  startTrack(data: unknown): unknown {
    const args = data as { label?: string }
    const session: Session = {
      id: this.nextId(),
      label: labelOf(args.label),
      startedAt: Date.now(),
      stoppedAt: 0,
    }
    this.state.sessions.push(session)
    this.persistAndPublish()
    return { id: session.id }
  }

  // stopTrack stops the given session, or the most recent running one when no
  // id is passed.
  stopTrack(data: unknown): unknown {
    const args = data as { id?: string }
    const session = this.findRunningSession(args.id)
    if (session === null) {
      return { error: 'no running session' }
    }
    session.stoppedAt = Date.now()
    this.persistAndPublish()
    return { id: session.id }
  }

  private findRunningSession(id: string | undefined): Session | null {
    for (let index = this.state.sessions.length - 1; index >= 0; index--) {
      const session = this.state.sessions[index]
      if (session.stoppedAt !== 0) {
        continue
      }
      if (id === undefined || id === '' || session.id === id) {
        return session
      }
    }
    return null
  }

  private fireExpired(): void {
    const current = Date.now()
    const expired = this.state.timers.filter((timer) => timer.endsAt <= current)
    if (expired.length === 0) {
      return
    }
    this.state.timers = this.state.timers.filter((timer) => timer.endsAt > current)
    this.persistAndPublish()
    for (const timer of expired) {
      this.notifyExpiry(timer)
    }
  }

  private notifyExpiry(timer: Timer): void {
    if (!this.notify) {
      return
    }
    let body = 'Timer finished'
    if (timer.label !== '') {
      body = timer.label
    }
    try {
      Bun.spawn(['notify-send', '-a', 'neoshell', 'Timer', body], {
        stdout: 'ignore',
        stderr: 'ignore',
      })
    } catch {
      // best-effort; no notification daemon is not our problem
    }
  }

  private nextId(): string {
    this.sequence += 1
    return `${Date.now().toString(36)}-${this.sequence}`
  }

  private persistAndPublish(): void {
    persistState(this.dataPath, this.state)
    this.clearRetained()
    this.clearRetained = this.bus.retain('timers', this.snapshot())
  }
}

function resolveDataPath(config: TimersConfig | undefined): string {
  if (config !== undefined && config.dataPath !== undefined) {
    return config.dataPath
  }
  let base = process.env.XDG_DATA_HOME
  if (base === undefined || base === '') {
    base = join(homedir(), '.local', 'share')
  }
  return join(base, 'neoshell', 'timers.json')
}

function resolveTickMs(config: TimersConfig | undefined): number {
  if (config !== undefined && config.tickMs !== undefined) {
    return config.tickMs
  }
  return 1000
}

function resolveNotify(config: TimersConfig | undefined): boolean {
  if (config !== undefined && config.notify !== undefined) {
    return config.notify
  }
  return true
}

function labelOf(label: string | undefined): string {
  if (label === undefined) {
    return ''
  }
  return label
}

function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function parseState(raw: string): TimersState | null {
  try {
    const parsed = JSON.parse(raw) as TimersState
    return {
      timers: arrayOf(parsed.timers),
      sessions: arrayOf(parsed.sessions),
    }
  } catch {
    return null
  }
}

function arrayOf<Item>(value: Item[] | undefined): Item[] {
  if (Array.isArray(value)) {
    return value
  }
  return []
}

// persistState writes atomically (tmp + rename) so a crash mid-write never
// corrupts the state file.
function persistState(path: string, state: TimersState): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    const temporary = path + '.tmp'
    writeFileSync(temporary, JSON.stringify(state))
    renameSync(temporary, path)
  } catch (error) {
    console.error(`timers: persist to ${path} failed:`, error)
  }
}
