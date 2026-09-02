import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Plugin } from '@neoworks/extension-system'
import { requireService } from '../lib/services.js'
import { registerFunction } from '../lib/bus.js'
import type { BusService } from '../lib/bus.js'

// deskminder: desktop reminders. A reminder is a due time and a line of text —
// the desktop pill creates them, the fullscreen alert clears them. State
// persists to XDG data and is one retained bus topic:
//
//   reminders          retained {reminders: [{id, text, armedAt, dueAt, firedAt}]}
//   reminder:create    {dueAt} or {seconds}, plus optional text → {id} | {error}
//   reminder:cancel    {id}
//   reminder:dismiss   {id}              clears one that has gone off
//   reminder:snooze    {id, seconds?}    re-arms one for the snooze length
//   reminder:repeat    {id}              re-arms one for the span it first ran
//   reminder:list      → snapshot
//
// firedAt is 0 while a reminder is pending and the moment it went off after
// that, so a single topic carries both what the pill lists and what the alert
// shows. Where the pill sits on the desktop is not here: placement is config's
// answer, under deskminder.pill, written by the view.

export interface Reminder {
  id: string
  text: string
  // When the reminder was armed. Only the progress ring needs it — how far a
  // countdown has run is not derivable from the due time alone.
  armedAt: number
  dueAt: number
  firedAt: number
}

interface RemindersState {
  reminders: Reminder[]
}

interface DeskminderConfig {
  dataPath?: string
  tickMs?: number
  snoozeSeconds?: number
}

const deskminderExtension: Plugin.Object<DeskminderConfig | undefined> = {
  name: 'deskminder',
  inject: ['bus'],
  apply(context, config) {
    const bus = requireService<BusService>(context, 'bus')
    const service = new RemindersService(bus, config)
    service.load()
    context.effect(() => service.publishRetained())
    context.effect(() => service.startTicker())
    registerFunction(context, bus, 'reminder:create', (data) => service.create(data))
    registerFunction(context, bus, 'reminder:cancel', (data) => service.cancel(data))
    registerFunction(context, bus, 'reminder:dismiss', (data) => service.cancel(data))
    registerFunction(context, bus, 'reminder:snooze', (data) => service.snooze(data))
    registerFunction(context, bus, 'reminder:repeat', (data) => service.repeat(data))
    registerFunction(context, bus, 'reminder:list', () => service.snapshot())
  },
}

export default deskminderExtension

class RemindersService {
  private state: RemindersState = { reminders: [] }
  private sequence = 0
  private clearRetained: () => void = () => {}
  private readonly bus: BusService
  private readonly dataPath: string
  private readonly tickMs: number
  private readonly snoozeSeconds: number

  constructor(bus: BusService, config: DeskminderConfig | undefined) {
    this.bus = bus
    this.dataPath = resolveDataPath(config)
    this.tickMs = resolveTickMs(config)
    this.snoozeSeconds = resolveSnoozeSeconds(config)
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
    this.clearRetained = this.bus.retain('reminders', this.snapshot())
    return () => this.clearRetained()
  }

  startTicker(): () => void {
    const ticker = setInterval(() => this.fireDue(), this.tickMs)
    return () => clearInterval(ticker)
  }

  snapshot(): RemindersState {
    return structuredClone(this.state)
  }

  create(data: unknown): unknown {
    const args = data as { dueAt?: number; seconds?: number; text?: string }
    const dueAt = resolveDueAt(args)
    if (dueAt === null) {
      return { error: 'reminder:create needs a future dueAt or a positive seconds' }
    }
    const reminder: Reminder = {
      id: this.nextId(),
      text: textOf(args.text),
      armedAt: Date.now(),
      dueAt,
      firedAt: 0,
    }
    this.state.reminders.push(reminder)
    this.persistAndPublish()
    return { id: reminder.id }
  }

  // Cancelling a pending reminder and dismissing a fired one are the same
  // write: the entry goes. Nothing distinguishes them but the button pressed.
  cancel(data: unknown): unknown {
    const args = data as { id?: string }
    if (typeof args.id !== 'string' || args.id === '') {
      return { error: 'id is required' }
    }
    this.state.reminders = this.state.reminders.filter((reminder) => reminder.id !== args.id)
    this.persistAndPublish()
    return { ok: true }
  }

  snooze(data: unknown): unknown {
    const args = data as { id?: string; seconds?: number }
    return this.rearm(args.id, this.snoozeSecondsFor(args.seconds) * 1000)
  }

  // repeat runs the reminder again for as long as it ran the first time, which
  // is the difference from snoozing: a twenty-minute reminder repeats for
  // twenty minutes rather than for the snooze length.
  repeat(data: unknown): unknown {
    const args = data as { id?: string }
    const reminder = this.find(args.id)
    if (reminder === null) {
      return { error: 'no such reminder' }
    }
    return this.rearm(reminder.id, originalSpanMs(reminder, this.snoozeSeconds * 1000))
  }

  private rearm(id: string | undefined, spanMs: number): unknown {
    const reminder = this.find(id)
    if (reminder === null) {
      return { error: 'no such reminder' }
    }
    reminder.firedAt = 0
    reminder.armedAt = Date.now()
    reminder.dueAt = reminder.armedAt + spanMs
    this.persistAndPublish()
    return { id: reminder.id, dueAt: reminder.dueAt }
  }

  private find(id: string | undefined): Reminder | null {
    const reminder = this.state.reminders.find((entry) => entry.id === id)
    if (reminder === undefined) {
      return null
    }
    return reminder
  }

  private snoozeSecondsFor(seconds: number | undefined): number {
    if (typeof seconds === 'number' && seconds > 0) {
      return seconds
    }
    return this.snoozeSeconds
  }

  // A fired reminder stays in the state until it is dismissed: the alert reads
  // it from the same topic the pill reads, so the shell restarting mid-alert
  // brings the alert back rather than losing the reminder.
  private fireDue(): void {
    const current = Date.now()
    const due = this.state.reminders.filter((reminder) => isDue(reminder, current))
    if (due.length === 0) {
      return
    }
    for (const reminder of due) {
      reminder.firedAt = current
    }
    this.persistAndPublish()
  }

  private nextId(): string {
    this.sequence += 1
    return `${Date.now().toString(36)}-${this.sequence}`
  }

  private persistAndPublish(): void {
    persistState(this.dataPath, this.state)
    this.clearRetained()
    this.clearRetained = this.bus.retain('reminders', this.snapshot())
  }
}

function isDue(reminder: Reminder, current: number): boolean {
  return reminder.firedAt === 0 && reminder.dueAt <= current
}

// A reminder persisted before armedAt was recorded has no span to repeat, so
// it falls back to the snooze length rather than firing again immediately.
function originalSpanMs(reminder: Reminder, fallbackMs: number): number {
  const span = reminder.dueAt - reminder.armedAt
  if (reminder.armedAt <= 0 || span <= 0) {
    return fallbackMs
  }
  return span
}

// seconds wins over dueAt: a caller that passes both meant the relative one,
// which is what a keybind or a script writes.
function resolveDueAt(args: { dueAt?: number; seconds?: number }): number | null {
  if (typeof args.seconds === 'number' && args.seconds > 0) {
    return Date.now() + args.seconds * 1000
  }
  if (typeof args.dueAt === 'number' && args.dueAt > Date.now()) {
    return args.dueAt
  }
  return null
}

function resolveDataPath(config: DeskminderConfig | undefined): string {
  if (config !== undefined && config.dataPath !== undefined) {
    return config.dataPath
  }
  let base = process.env.XDG_DATA_HOME
  if (base === undefined || base === '') {
    base = join(homedir(), '.local', 'share')
  }
  return join(base, 'neoshell', 'reminders.json')
}

function resolveTickMs(config: DeskminderConfig | undefined): number {
  if (config !== undefined && config.tickMs !== undefined) {
    return config.tickMs
  }
  return 1000
}

function resolveSnoozeSeconds(config: DeskminderConfig | undefined): number {
  if (config !== undefined && config.snoozeSeconds !== undefined) {
    return config.snoozeSeconds
  }
  return 300
}

function textOf(text: string | undefined): string {
  if (text === undefined) {
    return ''
  }
  return text
}

function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function parseState(raw: string): RemindersState | null {
  try {
    const parsed: RemindersState = JSON.parse(raw)
    if (!Array.isArray(parsed.reminders)) {
      return { reminders: [] }
    }
    return { reminders: parsed.reminders.flatMap(persistedReminder) }
  } catch {
    return null
  }
}

// Every persisted entry is normalised on load. A file written before armedAt
// existed — or edited by hand — must not put undefined into the arithmetic the
// ticker and repeat do; an entry missing what identifies it is dropped.
function persistedReminder(value: unknown): Reminder[] {
  const entry = value as Partial<Reminder>
  if (typeof entry.id !== 'string' || typeof entry.dueAt !== 'number') {
    return []
  }
  return [
    {
      id: entry.id,
      text: textOf(entry.text),
      armedAt: numberOf(entry.armedAt),
      dueAt: entry.dueAt,
      firedAt: numberOf(entry.firedAt),
    },
  ]
}

function numberOf(value: number | undefined): number {
  if (typeof value !== 'number') {
    return 0
  }
  return value
}

// persistState writes atomically (tmp + rename) so a crash mid-write never
// corrupts the state file.
function persistState(path: string, state: RemindersState): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    const temporary = `${path}.tmp`
    writeFileSync(temporary, JSON.stringify(state))
    renameSync(temporary, path)
  } catch (error) {
    console.error(`deskminder: persist to ${path} failed:`, error)
  }
}
