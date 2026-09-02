import type { Context } from '@neoworks/extension-system'

// Shared bits for the deskminder views. BusLike mirrors the surface runtime's
// BusClient; views receive it through the 'bus' service. Every extension
// carries its own copy: an extension is a self-contained directory, and a
// views bundle that imported across extensions could not be dropped in alone.

export interface BusMessage {
  type: string
  data: unknown
}

export interface BusLike {
  publish(type: string, data: unknown): void
  subscribe(pattern: string, handler: (message: BusMessage) => void): () => void
  call(type: string, data: unknown, timeoutMs?: number): Promise<unknown>
}

// One entry of the retained "reminders" topic. firedAt is 0 while the reminder
// is pending and the moment it went off after that; armedAt is what the
// progress ring measures the countdown against.
export interface Reminder {
  id: string
  text: string
  armedAt: number
  dueAt: number
  firedAt: number
}

export function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  return value as Record<string, unknown>
}

export function remindersOf(value: unknown): Reminder[] {
  const list = recordOf(value).reminders
  if (!Array.isArray(list)) {
    return []
  }
  return list.flatMap(reminderOf)
}

// A reminder without an id or a due time cannot be cancelled or counted down,
// so it is dropped rather than drawn as a dead row.
function reminderOf(value: unknown): Reminder[] {
  const entry = recordOf(value)
  if (typeof entry.id !== 'string' || typeof entry.dueAt !== 'number') {
    return []
  }
  return [
    {
      id: entry.id,
      text: stringOf(entry.text),
      armedAt: numberOf(entry.armedAt),
      dueAt: entry.dueAt,
      firedAt: numberOf(entry.firedAt),
    },
  ]
}

// A field that appears mid-interaction has to take the caret with it, or the
// next keystroke lands nowhere.
export function autofocus(element: HTMLInputElement): void {
  element.focus()
  element.select()
}

function stringOf(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  return ''
}

function numberOf(value: unknown): number {
  if (typeof value === 'number') {
    return value
  }
  return 0
}

// requireService reads a service the view plugin listed in its inject, where
// the kernel guarantees presence — it throws instead of returning undefined so
// callers skip the null check.
export function requireService<Value>(context: Context, name: string): Value {
  const value = context.get(name) as Value | undefined
  if (value === undefined) {
    throw new Error(`views: service "${name}" is not available`)
  }
  return value
}
