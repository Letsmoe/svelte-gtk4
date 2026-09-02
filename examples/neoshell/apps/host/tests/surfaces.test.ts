import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@neoworks/extension-system'
import { SurfaceRuntime } from '@neoshell/surface'
import { busPlugin } from '../src/plugins/bus.js'
import { httpPlugin } from '../src/plugins/http.js'
import type { HttpService } from '../src/plugins/http.js'
import { surfacesPlugin, SurfacesService } from '../src/plugins/surfaces.js'

// End-to-end remote-fiber bridge: host kernel and a SurfaceRuntime talking
// through a real WebSocket, view modules loaded over real HTTP. The runtime
// runs in-process here instead of a webview — same code, no DOM needed.

declare global {
  var __viewMounted: boolean | undefined
}

// Read through a function so TS narrowing from earlier assignments never
// sticks to the global across awaits.
function viewMounted(): boolean | undefined {
  return globalThis.__viewMounted
}

const VIEW_MODULE = `
export default {
  name: 'marker-view',
  apply(context) {
    globalThis.__viewMounted = true
    context.effect(() => () => {
      globalThis.__viewMounted = false
    })
  },
}
`

// Bun's import() resolves paths, not http URLs; a real webview fetches them
// natively. The test loader downloads the module to disk and imports that.
function makeTestLoader(dir: string): (url: string) => Promise<unknown> {
  let counter = 0
  return async (url) => {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`fetch ${url}: ${response.status}`)
    }
    counter += 1
    const file = join(dir, `fetched-${counter}.mjs`)
    writeFileSync(file, await response.text())
    return import(file)
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('waitFor timed out')
    }
    await Bun.sleep(10)
  }
}

describe('remote fiber bridge', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'neoshell-surfaces-test-'))
  const root = new Context()
  let surfaces = null as unknown as SurfacesService
  let viewUrl = ''
  let busUrl = ''
  const loadModule = makeTestLoader(tempDir)

  beforeAll(async () => {
    mkdirSync(join(tempDir, 'demo', 'dist'), { recursive: true })
    writeFileSync(join(tempDir, 'demo', 'dist', 'views.js'), VIEW_MODULE)
    writeFileSync(join(tempDir, 'demo', 'dist', 'broken.js'), 'export const notAPlugin = 1')

    await root.plugin(busPlugin)
    await root.plugin(httpPlugin, { port: 0, pluginsDir: tempDir })
    await root.plugin(surfacesPlugin)

    const port = (root.get('http') as HttpService).port
    viewUrl = `http://127.0.0.1:${port}/plugins/demo/views.js`
    busUrl = `ws://127.0.0.1:${port}/ws`
    surfaces = root.get('surfaces') as SurfacesService
  })

  afterAll(async () => {
    await root.fiber.dispose()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('mount before the surface exists is delivered once it announces ready', async () => {
    globalThis.__viewMounted = undefined
    const view = surfaces.mount('early', { url: viewUrl })
    expect(view.state).toBe('pending')

    const runtime = new SurfaceRuntime({ surfaceId: 'early', busUrl, loadModule })
    await runtime.start()
    await waitFor(() => view.state === 'active')

    expect(viewMounted()).toBe(true)

    await view.dispose()
    expect(view.state).toBe('disposed')
    expect(viewMounted()).toBe(false)
    await runtime.stop()
  })

  test('mount into a ready surface, dispose reverts the view kernel fiber', async () => {
    globalThis.__viewMounted = undefined
    const runtime = new SurfaceRuntime({ surfaceId: 'main', busUrl, loadModule })
    await runtime.start()

    const view = surfaces.mount('main', { url: viewUrl })
    await waitFor(() => view.state === 'active')
    expect(viewMounted()).toBe(true)

    await view.dispose()
    expect(viewMounted()).toBe(false)
    await runtime.stop()
  })

  test('a module that exports no plugin reports failed', async () => {
    const runtime = new SurfaceRuntime({ surfaceId: 'brokenhost', busUrl, loadModule })
    await runtime.start()

    const brokenUrl = viewUrl.replace('views.js', 'broken.js')
    const view = surfaces.mount('brokenhost', { url: brokenUrl })
    await waitFor(() => view.state === 'failed')

    expect(view.state).toBe('failed')
    await runtime.stop()
  })

  test('disposing a view on a vanished surface resolves without hanging', async () => {
    const view = surfaces.mount('ghost-surface', { url: viewUrl })
    await view.dispose()
    expect(view.state).toBe('disposed')
  })
})
