import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@neoworks/extension-system'
import { busPlugin } from '../src/plugins/bus.js'
import { configPlugin } from '../src/plugins/config.js'
import type { ConfigService } from '../src/plugins/config.js'
import {
  extensionsPlugin,
  installedEntries,
  widgetCatalog,
  widgetExtensionIds,
} from '../src/plugins/extensions.js'

declare global {
  var __extensionLog: string[] | undefined
}

function extensionLog(): string[] {
  if (globalThis.__extensionLog === undefined) {
    globalThis.__extensionLog = []
  }
  return globalThis.__extensionLog
}

const MARKER_BACKEND = `
export default {
  inject: ['bus'],
  apply(context, config) {
    globalThis.__extensionLog.push('mounted ' + JSON.stringify(config))
    context.effect(() => () => {
      globalThis.__extensionLog.push('disposed')
    })
  },
}
`

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('waitFor timed out')
    }
    await Bun.sleep(10)
  }
}

describe('extension loader', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'neoshell-extensions-test-'))
  const extensionsDir = join(tempDir, 'extensions')
  const configPath = join(tempDir, 'config.json')
  const root = new Context()
  let config = null as unknown as ConfigService

  beforeAll(async () => {
    extensionLog()
    mkdirSync(join(extensionsDir, 'marker'), { recursive: true })
    writeFileSync(
      join(extensionsDir, 'marker', 'manifest.json'),
      JSON.stringify({ id: 'marker', inject: ['bus'], backend: './backend.mjs' }),
    )
    writeFileSync(join(extensionsDir, 'marker', 'backend.mjs'), MARKER_BACKEND)
    writeFileSync(configPath, JSON.stringify({ extensions: [{ id: 'marker', config: { n: 1 } }] }))

    await root.plugin(busPlugin)
    await root.plugin(configPlugin, { path: configPath })
    await root.plugin(extensionsPlugin, { extensionsDir })
    config = null as unknown as ConfigService
    await waitFor(() => root.get('config') !== undefined)
    config = root.get('config') as ConfigService
  })

  afterAll(async () => {
    await root.fiber.dispose()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('an enabled entry mounts with its config', async () => {
    await waitFor(() => extensionLog().length >= 1)
    expect(extensionLog()[0]).toBe('mounted {"n":1}')
  })

  test('disabling the entry disposes the extension, re-enabling remounts it', async () => {
    config.set('extensions', [{ id: 'marker', config: { n: 1 }, disabled: true }])
    await waitFor(() => extensionLog().includes('disposed'))

    config.set('extensions', [{ id: 'marker', config: { n: 1 } }])
    await waitFor(() => extensionLog().length >= 3)
    expect(extensionLog()[2]).toBe('mounted {"n":1}')
  })

  test('an entry config change remounts with the new config', async () => {
    const before = extensionLog().length
    config.set('extensions', [{ id: 'marker', config: { n: 2 } }])
    await waitFor(() => extensionLog().length >= before + 2)

    expect(extensionLog().slice(before)).toEqual(['disposed', 'mounted {"n":2}'])
  })

  test('a missing extension directory is logged and skipped without breaking others', async () => {
    const before = extensionLog().length
    config.set('extensions', [{ id: 'ghost' }, { id: 'marker', config: { n: 3 } }])
    await waitFor(() => extensionLog().length >= before + 2)

    expect(extensionLog().slice(before)).toEqual(['disposed', 'mounted {"n":3}'])
  })

  // The ES module cache never re-reads a path it has already loaded, so this
  // asserts the reload picks up the file on disk, not the copy already loaded.
  test('a hot.backend announcement remounts from the rewritten file', async () => {
    const before = extensionLog().length
    writeFileSync(
      join(extensionsDir, 'marker', 'backend.mjs'),
      MARKER_BACKEND.replace("'mounted '", "'remounted '"),
    )
    const bus = root.get('bus') as { publish(type: string, data: unknown): void }
    bus.publish('hot.backend', { id: 'marker' })
    await waitFor(() => extensionLog().length >= before + 2)

    expect(extensionLog().slice(before)).toEqual(['disposed', 'remounted {"n":3}'])
  })
})

describe('mount list fallback', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'neoshell-extensions-default-'))
  const extensionsDir = join(tempDir, 'extensions')
  const configPath = join(tempDir, 'config.json')
  const root = new Context()

  beforeAll(async () => {
    extensionLog().length = 0
    mkdirSync(join(extensionsDir, 'marker'), { recursive: true })
    mkdirSync(join(extensionsDir, 'no-manifest'), { recursive: true })
    writeFileSync(
      join(extensionsDir, 'marker', 'manifest.json'),
      JSON.stringify({ id: 'marker', inject: ['bus'], backend: './backend.mjs' }),
    )
    writeFileSync(join(extensionsDir, 'marker', 'backend.mjs'), MARKER_BACKEND)
    // No "extensions" key at all — the shell must still come up usable.
    writeFileSync(configPath, JSON.stringify({ dock: { apps: [] } }))

    await root.plugin(busPlugin)
    await root.plugin(configPlugin, { path: configPath })
    await root.plugin(extensionsPlugin, { extensionsDir })
    await waitFor(() => root.get('config') !== undefined)
  })

  afterAll(async () => {
    await root.fiber.dispose()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('a config without an extensions key mounts what is installed', async () => {
    await waitFor(() => extensionLog().length >= 1)
    expect(extensionLog()[0]).toBe('mounted undefined')
  })

  test('installedEntries lists only directories carrying a manifest', () => {
    expect(installedEntries(extensionsDir)).toEqual([{ id: 'marker' }])
    expect(installedEntries(join(tempDir, 'missing'))).toEqual([])
  })
})

describe('an explicit empty list stays empty', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'neoshell-extensions-empty-'))
  const extensionsDir = join(tempDir, 'extensions')
  const configPath = join(tempDir, 'config.json')
  const root = new Context()

  beforeAll(async () => {
    extensionLog().length = 0
    mkdirSync(join(extensionsDir, 'marker'), { recursive: true })
    writeFileSync(
      join(extensionsDir, 'marker', 'manifest.json'),
      JSON.stringify({ id: 'marker', inject: ['bus'], backend: './backend.mjs' }),
    )
    writeFileSync(join(extensionsDir, 'marker', 'backend.mjs'), MARKER_BACKEND)
    writeFileSync(configPath, JSON.stringify({ extensions: [] }))

    await root.plugin(busPlugin)
    await root.plugin(configPlugin, { path: configPath })
    await root.plugin(extensionsPlugin, { extensionsDir })
    await waitFor(() => root.get('config') !== undefined)
  })

  afterAll(async () => {
    await root.fiber.dispose()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('nothing mounts', async () => {
    await Bun.sleep(200)
    expect(extensionLog()).toEqual([])
  })
})

// The gallery lists what the installed manifests declare, not what is running:
// a widget is offered because its extension is present.
describe('the widget catalog', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'neoshell-catalog-'))
  const extensionsDir = join(tempDir, 'extensions')

  beforeAll(() => {
    writeManifest('full', {
      id: 'full',
      widgets: [
        {
          type: 'full.card',
          name: 'Full',
          category: 'Weather',
          description: 'Everything declared.',
          sizes: ['small', 'large'],
          defaultSize: 'large',
        },
      ],
    })
    writeManifest('sparse', { id: 'sparse', widgets: [{ type: 'sparse.card', name: 'Sparse' }] })
    writeManifest('broken', { id: 'broken', widgets: [{ name: 'No type' }, 'nonsense'] })
    writeManifest('none', { id: 'none' })
  })

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  function writeManifest(name: string, manifest: unknown): void {
    mkdirSync(join(extensionsDir, name), { recursive: true })
    writeFileSync(join(extensionsDir, name, 'manifest.json'), JSON.stringify(manifest))
  }

  test('a fully declared widget survives intact', () => {
    const full = widgetCatalog(extensionsDir).find((widget) => widget.type === 'full.card')

    expect(full).toEqual({
      type: 'full.card',
      name: 'Full',
      category: 'Weather',
      description: 'Everything declared.',
      sizes: ['small', 'large'],
      defaultSize: 'large',
    })
  })

  test('a sparse declaration is filled in rather than dropped', () => {
    const sparse = widgetCatalog(extensionsDir).find((widget) => widget.type === 'sparse.card')

    expect(sparse?.category).toBe('Other')
    expect(sparse?.sizes).toEqual(['small'])
    expect(sparse?.defaultSize).toBe('small')
  })

  test('an entry with no type is not a widget, and an extension may declare none', () => {
    const types = widgetCatalog(extensionsDir).map((widget) => widget.type)

    expect(types.sort()).toEqual(['full.card', 'sparse.card'])
  })

  test('a directory that is not an extension contributes nothing', () => {
    expect(widgetCatalog(join(tempDir, 'missing'))).toEqual([])
  })
})

// Widgets are placed from config, so the view tree no longer names the types a
// widget host will be asked to mount. Without this list the desktop and the
// gallery would resolve every widget type to nothing.
describe('widget providers', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'neoshell-providers-'))
  const extensionsDir = join(tempDir, 'extensions')

  beforeAll(() => {
    write('weather', { id: 'weather', widgets: [{ type: 'weather.card', name: 'Weather' }] })
    write('hypr', { id: 'hypr' })
    write('empty', { id: 'empty', widgets: [] })
  })

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  function write(name: string, manifest: unknown): void {
    mkdirSync(join(extensionsDir, name), { recursive: true })
    writeFileSync(join(extensionsDir, name, 'manifest.json'), JSON.stringify(manifest))
  }

  test('only extensions that declare a widget are providers', () => {
    expect(widgetExtensionIds(extensionsDir)).toEqual(['weather'])
  })

  test('a directory that is not an extension contributes no providers', () => {
    expect(widgetExtensionIds(join(tempDir, 'missing'))).toEqual([])
  })
})
