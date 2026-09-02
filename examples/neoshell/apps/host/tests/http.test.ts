import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@neoworks/extension-system'
import { Bus } from '../src/bus.js'
import { busPlugin } from '../src/plugins/bus.js'
import { httpPlugin } from '../src/plugins/http.js'
import type { HttpService } from '../src/plugins/http.js'

describe('http server', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'neoshell-http-test-'))
  const pluginsDir = join(tempDir, 'plugins')
  const root = new Context()
  let baseUrl = ''

  beforeAll(async () => {
    mkdirSync(join(pluginsDir, 'demo', 'dist'), { recursive: true })
    writeFileSync(join(pluginsDir, 'demo', 'dist', 'index.html'), '<h1>demo</h1>')
    writeFileSync(join(pluginsDir, 'demo', 'dist', 'views.js'), 'export const ok = true')

    await root.plugin(busPlugin)
    await root.plugin(httpPlugin, { port: 0, pluginsDir })
    const service = root.get('http') as HttpService
    baseUrl = `http://127.0.0.1:${service.port}`
  })

  afterAll(async () => {
    await root.fiber.dispose()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('serves a plugin bundle from its dist directory', async () => {
    const index = await fetch(`${baseUrl}/plugins/demo/`)
    expect(index.status).toBe(200)
    expect(await index.text()).toBe('<h1>demo</h1>')

    const moduleFile = await fetch(`${baseUrl}/plugins/demo/views.js`)
    expect(moduleFile.status).toBe(200)
  })

  test('rejects path traversal and unknown files', async () => {
    const traversal = await fetch(`${baseUrl}/plugins/demo/../../secret`)
    expect(traversal.status).toBe(404)

    const missing = await fetch(`${baseUrl}/plugins/demo/nope.js`)
    expect(missing.status).toBe(404)

    const noPlugin = await fetch(`${baseUrl}/plugins/`)
    expect(noPlugin.status).toBe(404)
  })

  test('websocket peers publish to and receive from the bus', async () => {
    const bus = root.get('bus') as Bus
    const fromWs: unknown[] = []
    bus.subscribe('ws.out', (message) => {
      fromWs.push(message.data)
    })

    const ws = new WebSocket(`ws://127.0.0.1:${new URL(baseUrl).port}/ws`)
    const received: string[] = []
    ws.onmessage = (event) => {
      received.push(String(event.data))
    }
    await new Promise<void>((resolve) => {
      ws.onopen = () => resolve()
    })

    ws.send(JSON.stringify({ subscribe: ['ws.in'] }))
    ws.send(JSON.stringify({ type: 'ws.out', data: 'from-webview' }))
    await Bun.sleep(50)
    bus.publish('ws.in', 'from-host')
    await Bun.sleep(50)

    expect(fromWs).toEqual(['from-webview'])
    expect(received).toHaveLength(1)
    expect(JSON.parse(received[0])).toEqual({ type: 'ws.in', data: 'from-host' })
    ws.close()
  })
})
