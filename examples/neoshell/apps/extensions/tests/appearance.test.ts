import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Socket } from 'bun'
import { Context } from '@neoworks/extension-system'
import type { Fiber } from '@neoworks/extension-system'
import appearanceExtension from '../appearance/backend.js'
import { busProvider, FakeBus, waitFor } from './helpers.js'

// FakeBgDaemon: the neoshell-bg socket — records commands, can push color
// lines to subscribed clients.
class FakeBgDaemon {
  readonly commands: string[] = []
  private readonly subscribers = new Set<Socket<undefined>>()
  private listener: { stop(closeActive?: boolean): void } | null = null

  start(socketPath: string): void {
    const daemon = this
    this.listener = Bun.listen<undefined>({
      unix: socketPath,
      socket: {
        data(socket, chunk) {
          daemon.handle(socket, chunk.toString())
        },
        close(socket) {
          daemon.subscribers.delete(socket)
        },
      },
    })
  }

  stop(): void {
    if (this.listener !== null) {
      this.listener.stop(true)
    }
  }

  pushColors(stops: number[][]): void {
    for (const socket of this.subscribers) {
      socket.write(JSON.stringify({ type: 'colors', stops }) + '\n')
    }
  }

  private handle(socket: Socket<undefined>, raw: string): void {
    for (const line of raw.split('\n')) {
      this.handleLine(socket, line)
    }
  }

  private handleLine(socket: Socket<undefined>, line: string): void {
    if (line.trim() === '') {
      return
    }
    this.commands.push(line)
    const message = JSON.parse(line) as { cmd?: string }
    if (message.cmd === 'subscribe') {
      this.subscribers.add(socket)
    }
  }
}

describe('appearance extension', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'neoshell-appearance-test-'))
  const bgSocketPath = join(tempDir, 'bg.sock')
  const daemon = new FakeBgDaemon()
  const root = new Context()
  const bus = new FakeBus()
  let fiber = null as unknown as Fiber

  beforeAll(async () => {
    daemon.start(bgSocketPath)
    await root.plugin(busProvider(bus))
    fiber = await root.plugin(appearanceExtension, { bgSocketPath, reconnectMs: 50 })
  })

  afterAll(async () => {
    await root.fiber.dispose()
    daemon.stop()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('daemon colors land as the retained theme.bar topic', async () => {
    await waitFor(() => daemon.commands.some((command) => command.includes('subscribe')))
    daemon.pushColors([[10, 20, 30]])

    await waitFor(() => bus.retained.has('theme.bar'))
    expect(bus.retained.get('theme.bar')).toEqual({ stops: [[10, 20, 30]] })
  })

  test('wallpaper:set forwards an img command to the daemon', async () => {
    const reply = (await bus.call('wallpaper:set', { path: '/tmp/w.png' })) as { ok?: boolean }
    expect(reply.ok).toBe(true)

    await waitFor(() => daemon.commands.some((command) => command.includes('/tmp/w.png')))
    const bad = (await bus.call('wallpaper:set', {})) as { error?: string }
    expect(bad.error).toContain('required')
  })

  test('a config change pushes wallpaper and blur, unchanged values are skipped', async () => {
    bus.publish('config', {
      appearance: { wallpaper: '/tmp/from-config.jpg', background: { blur: 12 } },
    })

    await waitFor(() =>
      bus.published.some(
        (message) =>
          message.type === 'wallpaper:set' &&
          (message.data as { path: string }).path === '/tmp/from-config.jpg',
      ),
    )
    const blurPublishes = bus.published.filter((message) => message.type === 'hypr:keyword')
    expect(blurPublishes.some((message) => (message.data as { value: string }).value === '12')).toBe(
      true,
    )

    const before = bus.published.length
    bus.publish('config', {
      appearance: { wallpaper: '/tmp/from-config.jpg', background: { blur: 12 } },
    })
    await Bun.sleep(30)
    const newApplies = bus.published
      .slice(before)
      .filter((message) => message.type === 'wallpaper:set' || message.type === 'hypr:keyword')
    expect(newApplies).toHaveLength(0)
  })
})
