import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@neoworks/extension-system'
import type { Plugin } from '@neoworks/extension-system'
import { SurfaceRuntime } from '@neoshell/surface'
import { busPlugin } from '../src/plugins/bus.js'
import type { Bus } from '../src/bus.js'
import { configPlugin } from '../src/plugins/config.js'
import type { ConfigService } from '../src/plugins/config.js'
import { httpPlugin } from '../src/plugins/http.js'
import type { HttpService } from '../src/plugins/http.js'
import { surfacesPlugin } from '../src/plugins/surfaces.js'
import { viewTreePlugin } from '../src/plugins/viewTree.js'

// The whole pipeline, render host excluded: config tree → retained "views"
// topic → view-module mounts into a live SurfaceRuntime (one per layer) →
// registered types.

const VIEWS_MODULE = `
export default {
  name: 'demo-views',
  inject: ['ui'],
  apply(context) {
    const ui = context.get('ui')
    context.effect(() => ui.register('demo.panel', () => ({ dispose() {} })))
  },
}
`

const TREE = [
  {
    id: 'bar',
    type: 'demo.panel',
    args: { layer: 'top', anchors: ['top'], keyboard: 'none' },
  },
]

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

describe('view tree', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'neoshell-viewtree-test-'))
  const extensionsDir = join(tempDir, 'extensions')
  const configPath = join(tempDir, 'config.json')
  const root = new Context()
  let runtime = null as unknown as SurfaceRuntime
  let config = null as unknown as ConfigService

  beforeAll(async () => {
    mkdirSync(join(extensionsDir, 'demo', 'dist'), { recursive: true })
    writeFileSync(join(extensionsDir, 'demo', 'manifest.json'), JSON.stringify({
      id: 'demo',
      views: 'views.js',
    }))
    writeFileSync(join(extensionsDir, 'demo', 'dist', 'views.js'), VIEWS_MODULE)
    writeFileSync(configPath, JSON.stringify({ views: TREE }))

    await root.plugin(busPlugin)
    await root.plugin(configPlugin, { path: configPath })
    await root.plugin(httpPlugin, { port: 0, pluginsDir: extensionsDir })
    await root.plugin(surfacesPlugin)
    await root.plugin(viewTreePlugin, { extensionsDir })
    await waitFor(() => root.get('http') !== undefined)
    config = root.get('config') as ConfigService

    // The runtime plays the "top" layer webview — nodes mount per layer.
    const port = (root.get('http') as HttpService).port
    runtime = new SurfaceRuntime({
      surfaceId: 'top',
      busUrl: `ws://127.0.0.1:${port}/ws`,
      loadModule: makeTestLoader(tempDir),
    })
    await runtime.start()
  })

  afterAll(async () => {
    await runtime.stop()
    await root.fiber.dispose()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('the layer webview receives the views module and registers its types', async () => {
    await waitFor(() => runtime.views.resolve('demo.panel') !== undefined)
    expect(runtime.views.resolve('demo.panel')).toBeDefined()
  })

  test('the tree is a retained topic surfaces can render from', async () => {
    const received: unknown[] = []
    const unsubscribe = runtime.bus.subscribe('views', (message) => {
      received.push(message.data)
    })
    await waitFor(() => received.length >= 1)

    expect(received[0]).toEqual(TREE)
    unsubscribe()
  })

  test('removing the layer from the tree disposes its view mounts', async () => {
    config.set('views', [])
    await waitFor(() => runtime.views.resolve('demo.panel') === undefined)
  })
})

// ---- surface planning against a fake render host ----

interface CreatedSurface {
  role: string
  url: string
  monitor: string
  layer: string
  anchors: string[]
  keyboard: string
  exclusiveEdge?: string
  exclusiveSize?: number
}

class FakeRenderHost {
  created: CreatedSurface[] = []
  destroyed: string[] = []
  regions: Array<{ role: string; rects: unknown[] }> = []

  createSurface(spec: CreatedSurface): void {
    this.created.push(spec)
  }

  destroy(role: string): void {
    this.destroyed.push(role)
  }

  setInputRegion(role: string, rects: unknown[]): void {
    this.regions.push({ role, rects })
  }
}

function fakeRenderHostPlugin(fake: FakeRenderHost): Plugin.Object {
  return {
    name: 'fake-render-host',
    apply(context) {
      context.provide('renderhost', fake)
    },
  }
}

// connectingRenderHostPlugin mirrors the real plugin's shape: an async apply
// that awaits its socket, then provides the service and announces itself from
// inside the same apply — so both happen before the fiber is active.
function connectingRenderHostPlugin(fake: FakeRenderHost): Plugin.Object {
  return {
    name: 'connecting-render-host',
    inject: ['bus'],
    async apply(context) {
      const bus = context.get('bus') as Bus
      await Bun.sleep(1)
      context.provide('renderhost', fake)
      context.effect(() => bus.retain('render.connected', true))
    },
  }
}

const LAYERED_TREE = [
  {
    id: 'bar',
    type: 'demo.panel',
    args: {
      layer: 'top',
      anchors: ['top', 'left', 'right'],
      keyboard: 'ondemand',
      height: 36,
      exclusiveEdge: 'top',
      exclusiveSize: 36,
    },
  },
  {
    id: 'dock',
    type: 'demo.panel',
    args: {
      layer: 'top',
      anchors: ['bottom', 'left', 'right'],
      keyboard: 'none',
      height: 76,
      exclusiveEdge: 'bottom',
      exclusiveSize: 76,
    },
  },
  {
    id: 'desktop',
    type: 'demo.panel',
    args: { layer: 'background', anchors: ['top', 'bottom', 'left', 'right'], keyboard: 'none' },
  },
]

describe('view tree surfaces', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'neoshell-viewtree-surfaces-'))
  const configPath = join(tempDir, 'config.json')
  const root = new Context()
  const fake = new FakeRenderHost()
  let bus = null as unknown as Bus
  let config = null as unknown as ConfigService

  beforeAll(async () => {
    writeFileSync(configPath, JSON.stringify({ views: LAYERED_TREE }))
    await root.plugin(busPlugin)
    await root.plugin(configPlugin, { path: configPath })
    await root.plugin(httpPlugin, { port: 0, pluginsDir: tempDir })
    await root.plugin(surfacesPlugin)
    await root.plugin(fakeRenderHostPlugin(fake))
    await root.plugin(viewTreePlugin, { extensionsDir: tempDir })
    bus = root.get('bus') as Bus
    config = root.get('config') as ConfigService
  })

  afterAll(async () => {
    await root.fiber.dispose()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('one webview per used layer, full-screen and initially click-through', () => {
    const webviews = fake.created.filter((spec) => spec.url !== '')
    expect(webviews.map((spec) => spec.role).sort()).toEqual(['background', 'top'])

    const top = webviews.find((spec) => spec.role === 'top')
    expect(top?.anchors.sort()).toEqual(['bottom', 'left', 'right', 'top'])
    expect(top?.keyboard).toBe('ondemand')
    expect(top?.url).toContain('/surface?surface=top')
    expect(fake.regions).toContainEqual({ role: 'top', rects: [] })
  })

  test('exclusive-zone nodes get contentless reservation surfaces', () => {
    const reservations = fake.created.filter((spec) => spec.url === '')
    expect(reservations.map((spec) => spec.role).sort()).toEqual(['reserve.bar', 'reserve.dock'])

    const barReservation = reservations.find((spec) => spec.role === 'reserve.bar')
    expect(barReservation?.exclusiveEdge).toBe('top')
    expect(barReservation?.exclusiveSize).toBe(36)
    expect(barReservation?.layer).toBe('top')
  })

  test('reported input rects are forwarded as the layer input region', async () => {
    const rect = { x: 0, y: 0, w: 800, h: 36 }
    bus.publish('surface.top.input', { rects: [rect] })
    await waitFor(() => fake.regions.some((entry) => entry.rects.length === 1))

    const forwarded = fake.regions.find((entry) => entry.rects.length === 1)
    expect(forwarded?.role).toBe('top')
    expect(forwarded?.rects[0]).toEqual(rect)
  })

  test('emptying a layer destroys its webview and reservations', async () => {
    config.set('views', [LAYERED_TREE[2]])
    await waitFor(() => fake.destroyed.length >= 3)
    expect(fake.destroyed.sort()).toEqual(['reserve.bar', 'reserve.dock', 'top'])
  })
})

describe('view tree render host race', () => {
  test('surfaces replay when the render host connects after the tree applied', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'neoshell-viewtree-race-'))
    const configPath = join(tempDir, 'config.json')
    writeFileSync(configPath, JSON.stringify({ views: LAYERED_TREE }))
    const root = new Context()
    const fake = new FakeRenderHost()

    await root.plugin(busPlugin)
    await root.plugin(configPlugin, { path: configPath })
    await root.plugin(httpPlugin, { port: 0, pluginsDir: tempDir })
    await root.plugin(surfacesPlugin)
    await root.plugin(viewTreePlugin, { extensionsDir: tempDir })
    expect(fake.created).toHaveLength(0)

    // The real plugin connects its socket before providing, so both the
    // service and render.connected land while its fiber is still loading — the
    // view tree must still see the service and replay the whole plan.
    await root.plugin(connectingRenderHostPlugin(fake))
    await waitFor(() => fake.created.length >= 4)

    expect(fake.created.map((spec) => spec.role).sort()).toEqual([
      'background',
      'reserve.bar',
      'reserve.dock',
      'top',
    ])
    await root.fiber.dispose()
    rmSync(tempDir, { recursive: true, force: true })
  })
})

// ---- output selection ----

describe('view tree monitor', () => {
  test('the configured monitor lands on every surface, and changing it recreates them', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'neoshell-viewtree-monitor-'))
    const configPath = join(tempDir, 'config.json')
    writeFileSync(configPath, JSON.stringify({ monitor: 'DP-2', views: LAYERED_TREE }))
    const root = new Context()
    const fake = new FakeRenderHost()

    await root.plugin(busPlugin)
    await root.plugin(configPlugin, { path: configPath })
    await root.plugin(httpPlugin, { port: 0, pluginsDir: tempDir })
    await root.plugin(surfacesPlugin)
    await root.plugin(fakeRenderHostPlugin(fake))
    await root.plugin(viewTreePlugin, { extensionsDir: tempDir })

    await waitFor(() => fake.created.length >= 4)
    expect(fake.created.every((spec) => spec.monitor === 'DP-2')).toBe(true)

    const config = root.get('config') as ConfigService
    config.set('monitor', 'HDMI-A-1')
    await waitFor(() => fake.destroyed.length >= 4)
    await waitFor(() => fake.created.length >= 8)
    expect(fake.created.slice(4).every((spec) => spec.monitor === 'HDMI-A-1')).toBe(true)

    await root.fiber.dispose()
    rmSync(tempDir, { recursive: true, force: true })
  })
})

// ---- views served from source in development ----

describe('view modules in development', () => {
  test('are imported from the dev server, unversioned', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'neoshell-viewsdev-test-'))
    const configPath = join(tempDir, 'config.json')
    mkdirSync(join(tempDir, 'demo'), { recursive: true })
    writeFileSync(
      join(tempDir, 'demo', 'manifest.json'),
      JSON.stringify({ id: 'demo', views: 'views.js' }),
    )
    writeFileSync(configPath, JSON.stringify({ views: TREE }))
    const root = new Context()

    await root.plugin(busPlugin)
    await root.plugin(configPlugin, { path: configPath })
    await root.plugin(httpPlugin, { port: 0, pluginsDir: tempDir })
    await root.plugin(surfacesPlugin)
    await root.plugin(viewTreePlugin, {
      extensionsDir: tempDir,
      viewsDevOrigin: 'http://127.0.0.1:5174/',
    })

    const bus = root.get('bus') as Bus
    const mounted: string[] = []
    const unsubscribe = bus.subscribe('surface.top.mount', (message) => {
      mounted.push((message.data as { url: string }).url)
    })
    bus.publish('surface.top.ready', {})
    await waitFor(() => mounted.length >= 1)

    expect(mounted[0]).toBe('http://127.0.0.1:5174/demo/src/views.ts')
    unsubscribe()
    await root.fiber.dispose()
    rmSync(tempDir, { recursive: true, force: true })
  })
})
