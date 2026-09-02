import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@neoworks/extension-system'
import type { Fiber } from '@neoworks/extension-system'
import timersExtension from '../timers/backend.js'
import { busProvider, FakeBus, waitFor } from './helpers.js'

interface TimersSnapshot {
  timers: Array<{ id: string; label: string; endsAt: number }>
  sessions: Array<{ id: string; label: string; startedAt: number; stoppedAt: number }>
}

function retainedSnapshot(bus: FakeBus): TimersSnapshot {
  return bus.retained.get('timers') as TimersSnapshot
}

describe('timers extension', () => {
  const cleanups: Array<() => Promise<void> | void> = []

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) {
      await cleanup()
    }
    cleanups.length = 0
  })

  async function mountTimers(dataPath: string): Promise<{ bus: FakeBus; fiber: Fiber }> {
    const root = new Context()
    const bus = new FakeBus()
    await root.plugin(busProvider(bus))
    const fiber = await root.plugin(timersExtension, { dataPath, tickMs: 20, notify: false })
    cleanups.push(() => root.fiber.dispose())
    return { bus, fiber }
  }

  function makeDataPath(): string {
    const dir = mkdtempSync(join(tmpdir(), 'neoshell-timers-test-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    return join(dir, 'timers.json')
  }

  test('timer:start adds a retained timer, timer:stop removes it, state persists', async () => {
    const dataPath = makeDataPath()
    const { bus } = await mountTimers(dataPath)

    const started = (await bus.call('timer:start', { seconds: 3600, label: 'tea' })) as { id: string }
    expect(typeof started.id).toBe('string')
    expect(retainedSnapshot(bus).timers).toHaveLength(1)
    expect(retainedSnapshot(bus).timers[0].label).toBe('tea')
    expect(existsSync(dataPath)).toBe(true)

    await bus.call('timer:stop', { id: started.id })
    expect(retainedSnapshot(bus).timers).toHaveLength(0)
  })

  test('an invalid duration is rejected', async () => {
    const { bus } = await mountTimers(makeDataPath())

    const reply = await bus.call('timer:start', { seconds: -5 }) as { error?: string }
    expect(reply.error).toContain('positive')
    expect(retainedSnapshot(bus).timers).toHaveLength(0)
  })

  test('an expired timer leaves the state on the next tick', async () => {
    const { bus } = await mountTimers(makeDataPath())

    await bus.call('timer:start', { seconds: 0.01, label: 'blink' })
    expect(retainedSnapshot(bus).timers).toHaveLength(1)

    await waitFor(() => retainedSnapshot(bus).timers.length === 0)
  })

  test('track:start and track:stop record a labeled span', async () => {
    const { bus } = await mountTimers(makeDataPath())

    const started = (await bus.call('track:start', { label: 'deep work' })) as { id: string }
    let sessions = retainedSnapshot(bus).sessions
    expect(sessions[0].stoppedAt).toBe(0)

    const stopped = await bus.call('track:stop', {}) as { id: string }
    expect(stopped.id).toBe(started.id)
    sessions = retainedSnapshot(bus).sessions
    expect(sessions[0].stoppedAt).toBeGreaterThan(0)

    const again = await bus.call('track:stop', {}) as { error?: string }
    expect(again.error).toBe('no running session')
  })

  test('state survives a restart through the data file', async () => {
    const dataPath = makeDataPath()
    const first = await mountTimers(dataPath)
    await first.bus.call('timer:start', { seconds: 3600, label: 'persist me' })
    await first.fiber.dispose()
    expect(first.bus.retained.has('timers')).toBe(false)

    const second = await mountTimers(dataPath)
    expect(retainedSnapshot(second.bus).timers[0].label).toBe('persist me')
  })
})
