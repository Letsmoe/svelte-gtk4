import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@neoworks/extension-system'
import { Bus } from '../src/bus.js'
import { busPlugin } from '../src/plugins/bus.js'
import { configPlugin, getPath, setPath } from '../src/plugins/config.js'
import type { ConfigService } from '../src/plugins/config.js'

describe('dot-path helpers', () => {
  test('getPath walks nested objects and returns undefined off the tree', () => {
    const tree = { appearance: { background: { alpha: 0.42 } } }
    expect(getPath(tree, 'appearance.background.alpha')).toBe(0.42)
    expect(getPath(tree, 'appearance.missing.deep')).toBeUndefined()
  })

  test('setPath creates intermediate objects', () => {
    const tree: Record<string, unknown> = {}
    setPath(tree, 'bar.clock.hour12', true)
    expect(tree).toEqual({ bar: { clock: { hour12: true } } })
  })
})

describe('config store', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'neoshell-config-test-'))
  const configPath = join(tempDir, 'config.json')
  const root = new Context()

  beforeAll(async () => {
    writeFileSync(configPath, JSON.stringify({ appearance: { accent: '#a78bfa' } }))
    await root.plugin(busPlugin)
    await root.plugin(configPlugin, { path: configPath })
  })

  afterAll(async () => {
    await root.fiber.dispose()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('get reads the loaded file by dot-path', () => {
    const config = root.get('config') as ConfigService
    expect(config.get('appearance.accent')).toBe('#a78bfa')
  })

  test('the snapshot is a retained bus topic', () => {
    const bus = root.get('bus') as Bus
    const received: unknown[] = []
    const unsubscribe = bus.subscribe('config', (message) => {
      received.push(message.data)
    })

    expect(received).toHaveLength(1)
    expect(getPath(received[0] as Record<string, unknown>, 'appearance.accent')).toBe('#a78bfa')
    unsubscribe()
  })

  test('set persists to disk and republishes the retained snapshot', () => {
    const config = root.get('config') as ConfigService
    const bus = root.get('bus') as Bus

    config.set('dock.iconSize', 42)

    const onDisk = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
    expect(getPath(onDisk, 'dock.iconSize')).toBe(42)

    const received: unknown[] = []
    const unsubscribe = bus.subscribe('config', (message) => {
      received.push(message.data)
    })
    expect(getPath(received[0] as Record<string, unknown>, 'dock.iconSize')).toBe(42)
    unsubscribe()
  })

  // config:set is the only write path a surface has — the desktop persists a
  // dragged widget's cell through it.
  test('config:set writes a dot-path and replies ok', async () => {
    const bus = root.get('bus') as Bus

    const reply = await bus.call('config:set', {
      key: 'widgets.weather',
      value: { column: 3, row: 1 },
    })

    expect(reply).toEqual({ ok: true })
    const onDisk = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
    expect(getPath(onDisk, 'widgets.weather.column')).toBe(3)
  })

  test('config:set without a key replies with an error and writes nothing', async () => {
    const bus = root.get('bus') as Bus
    const config = root.get('config') as ConfigService

    const reply = await bus.call('config:set', { value: 1 })

    expect(reply).toEqual({ error: 'config:set needs a string key' })
    expect(config.get('widgets.weather.column')).toBe(3)
  })

  test('an external file write is picked up and republished', async () => {
    const bus = root.get('bus') as Bus
    // The persist() suppression window must pass before external writes count.
    await Bun.sleep(150)
    writeFileSync(configPath, JSON.stringify({ appearance: { accent: '#ff0000' } }))
    await Bun.sleep(300)

    const received: unknown[] = []
    const unsubscribe = bus.subscribe('config', (message) => {
      received.push(message.data)
    })
    expect(getPath(received[0] as Record<string, unknown>, 'appearance.accent')).toBe('#ff0000')
    unsubscribe()
  })

  // A writer that truncates in place is observable mid-write; an unparseable
  // read must not blank the tree every surface renders from.
  test('a truncated or invalid file keeps the last good snapshot', async () => {
    const bus = root.get('bus') as Bus
    writeFileSync(configPath, '')
    await Bun.sleep(300)

    const received: unknown[] = []
    const unsubscribe = bus.subscribe('config', (message) => {
      received.push(message.data)
    })
    expect(getPath(received[0] as Record<string, unknown>, 'appearance.accent')).toBe('#ff0000')
    unsubscribe()

    writeFileSync(configPath, JSON.stringify({ appearance: { accent: '#00ff00' } }))
    await Bun.sleep(300)
    const after: unknown[] = []
    const unsubscribeAfter = bus.subscribe('config', (message) => {
      after.push(message.data)
    })
    expect(getPath(after[0] as Record<string, unknown>, 'appearance.accent')).toBe('#00ff00')
    unsubscribeAfter()
  })
})
