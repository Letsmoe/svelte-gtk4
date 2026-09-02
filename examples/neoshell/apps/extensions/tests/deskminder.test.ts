import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@neoworks/extension-system'
import type { Fiber } from '@neoworks/extension-system'
import deskminderExtension from '../deskminder/backend.js'
import type { Reminder } from '../deskminder/backend.js'
import { busProvider, FakeBus, waitFor } from './helpers.js'

interface RemindersSnapshot {
  reminders: Reminder[]
}

function retainedSnapshot(bus: FakeBus): RemindersSnapshot {
  return bus.retained.get('reminders') as RemindersSnapshot
}

describe('deskminder extension', () => {
  const cleanups: Array<() => Promise<void> | void> = []

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) {
      await cleanup()
    }
    cleanups.length = 0
  })

  async function mountDeskminder(dataPath: string): Promise<{ bus: FakeBus; fiber: Fiber }> {
    const root = new Context()
    const bus = new FakeBus()
    await root.plugin(busProvider(bus))
    const fiber = await root.plugin(deskminderExtension, {
      dataPath,
      tickMs: 20,
      snoozeSeconds: 60,
    })
    cleanups.push(() => root.fiber.dispose())
    return { bus, fiber }
  }

  function makeDataPath(): string {
    const dir = mkdtempSync(join(tmpdir(), 'neoshell-deskminder-test-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    return join(dir, 'reminders.json')
  }

  test('reminder:create arms a reminder, reminder:cancel removes it, state persists', async () => {
    const dataPath = makeDataPath()
    const { bus } = await mountDeskminder(dataPath)

    const created = (await bus.call('reminder:create', {
      seconds: 3600,
      text: "Reply to John's email",
    })) as { id: string }
    expect(typeof created.id).toBe('string')
    expect(retainedSnapshot(bus).reminders).toHaveLength(1)
    expect(retainedSnapshot(bus).reminders[0].text).toBe("Reply to John's email")
    expect(retainedSnapshot(bus).reminders[0].firedAt).toBe(0)
    expect(retainedSnapshot(bus).reminders[0].armedAt).toBeLessThanOrEqual(Date.now())
    expect(existsSync(dataPath)).toBe(true)

    await bus.call('reminder:cancel', { id: created.id })
    expect(retainedSnapshot(bus).reminders).toHaveLength(0)
  })

  test('an absolute dueAt is honoured and a past one is rejected', async () => {
    const { bus } = await mountDeskminder(makeDataPath())

    const dueAt = Date.now() + 90 * 60 * 1000
    await bus.call('reminder:create', { dueAt, text: 'stand up' })
    expect(retainedSnapshot(bus).reminders[0].dueAt).toBe(dueAt)

    const rejected = (await bus.call('reminder:create', { dueAt: Date.now() - 1000 })) as {
      error?: string
    }
    expect(rejected.error).toContain('future dueAt')
    expect(retainedSnapshot(bus).reminders).toHaveLength(1)
  })

  test('a due reminder is marked fired and stays until it is dismissed', async () => {
    const { bus } = await mountDeskminder(makeDataPath())

    const created = (await bus.call('reminder:create', { seconds: 0.01, text: 'blink' })) as {
      id: string
    }
    await waitFor(() => retainedSnapshot(bus).reminders[0].firedAt !== 0)
    expect(retainedSnapshot(bus).reminders).toHaveLength(1)

    await bus.call('reminder:dismiss', { id: created.id })
    expect(retainedSnapshot(bus).reminders).toHaveLength(0)
  })

  test('reminder:snooze re-arms a fired reminder', async () => {
    const { bus } = await mountDeskminder(makeDataPath())

    const created = (await bus.call('reminder:create', { seconds: 0.01, text: 'again' })) as {
      id: string
    }
    await waitFor(() => retainedSnapshot(bus).reminders[0].firedAt !== 0)

    const armedAt = retainedSnapshot(bus).reminders[0].armedAt
    const snoozed = (await bus.call('reminder:snooze', { id: created.id })) as { dueAt: number }
    expect(snoozed.dueAt).toBeGreaterThan(Date.now())
    expect(retainedSnapshot(bus).reminders[0].firedAt).toBe(0)
    // The ring measures against armedAt, so a snooze has to restart it.
    expect(retainedSnapshot(bus).reminders[0].armedAt).toBeGreaterThanOrEqual(armedAt)
    expect(snoozed.dueAt - retainedSnapshot(bus).reminders[0].armedAt).toBe(60 * 1000)

    const missing = (await bus.call('reminder:snooze', { id: 'nope' })) as { error?: string }
    expect(missing.error).toBe('no such reminder')
  })

  // Repeat differs from snooze exactly here: it re-runs the span the reminder
  // was armed for, not the fixed snooze length.
  test('reminder:repeat re-arms for the span the reminder ran', async () => {
    const { bus } = await mountDeskminder(makeDataPath())

    const created = (await bus.call('reminder:create', {
      seconds: 20 * 60,
      text: 'stretch',
    })) as { id: string }

    const repeated = (await bus.call('reminder:repeat', { id: created.id })) as { dueAt: number }
    const reminder = retainedSnapshot(bus).reminders[0]
    expect(reminder.firedAt).toBe(0)
    expect(repeated.dueAt - reminder.armedAt).toBe(20 * 60 * 1000)

    const missing = (await bus.call('reminder:repeat', { id: 'nope' })) as { error?: string }
    expect(missing.error).toBe('no such reminder')
  })

  // A reminder written before armedAt was recorded has no span to repeat; the
  // snooze length is what keeps it from firing again the moment it is repeated.
  test('repeating a reminder with no armed time falls back to the snooze length', async () => {
    const dataPath = makeDataPath()
    mkdirSync(dirname(dataPath), { recursive: true })
    writeFileSync(
      dataPath,
      JSON.stringify({ reminders: [{ id: 'old', text: 'legacy', dueAt: 1, firedAt: 2 }] }),
    )
    const { bus } = await mountDeskminder(dataPath)

    const repeated = (await bus.call('reminder:repeat', { id: 'old' })) as { dueAt: number }
    expect(repeated.dueAt - retainedSnapshot(bus).reminders[0].armedAt).toBe(60 * 1000)
  })

  test('state survives a restart through the data file', async () => {
    const dataPath = makeDataPath()
    const first = await mountDeskminder(dataPath)
    await first.bus.call('reminder:create', { seconds: 3600, text: 'persist me' })
    await first.fiber.dispose()
    expect(first.bus.retained.has('reminders')).toBe(false)

    const second = await mountDeskminder(dataPath)
    expect(retainedSnapshot(second.bus).reminders[0].text).toBe('persist me')
  })
})
