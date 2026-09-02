import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Socket } from 'bun'
import { Context } from '@neoworks/extension-system'
import { Bus } from '../src/bus.js'
import { busPlugin } from '../src/plugins/bus.js'
import { unixSocketPlugin } from '../src/plugins/unixSocket.js'

// TestClient is a raw NDJSON peer on the unix socket, collecting every line
// the host writes back.
class TestClient {
  received: Array<Record<string, unknown>> = []
  private socket: Socket<undefined> | null = null
  private buffer = ''

  async connect(socketPath: string): Promise<void> {
    this.socket = await Bun.connect<undefined>({
      unix: socketPath,
      socket: {
        data: (_socket, chunk) => {
          this.feed(chunk.toString())
        },
      },
    })
  }

  send(message: Record<string, unknown>): void {
    const socket = this.socket as Socket<undefined>
    socket.write(JSON.stringify(message) + '\n')
  }

  close(): void {
    if (this.socket !== null) {
      this.socket.end()
    }
  }

  private feed(chunk: string): void {
    this.buffer += chunk
    const parts = this.buffer.split('\n')
    this.buffer = parts[parts.length - 1]
    for (const line of parts.slice(0, -1)) {
      this.received.push(JSON.parse(line) as Record<string, unknown>)
    }
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('waitFor timed out')
    }
    await Bun.sleep(5)
  }
}

describe('unix socket transport', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'neoshell-host-test-'))
  const socketPath = join(tempDir, 'bus.sock')
  const root = new Context()

  beforeAll(async () => {
    await root.plugin(busPlugin)
    await root.plugin(unixSocketPlugin, { socketPath })
  })

  afterAll(async () => {
    await root.fiber.dispose()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('a peer publish reaches another peer subscription', async () => {
    const subscriber = new TestClient()
    const publisher = new TestClient()
    await subscriber.connect(socketPath)
    await publisher.connect(socketPath)

    subscriber.send({ subscribe: ['test.*'] })
    await Bun.sleep(20)
    publisher.send({ type: 'test.ping', data: { n: 1 } })
    await waitFor(() => subscriber.received.length >= 1)

    expect(subscriber.received[0]).toEqual({ type: 'test.ping', data: { n: 1 } })
    subscriber.close()
    publisher.close()
  })

  test('retained values replay to late subscribers and die with the connection', async () => {
    const publisher = new TestClient()
    await publisher.connect(socketPath)
    publisher.send({ type: 'state.current', data: 'v1', retain: true })
    await Bun.sleep(20)

    const lateSubscriber = new TestClient()
    await lateSubscriber.connect(socketPath)
    lateSubscriber.send({ subscribe: ['state.*'] })
    await waitFor(() => lateSubscriber.received.length >= 1)
    expect(lateSubscriber.received[0].data).toBe('v1')

    publisher.close()
    await Bun.sleep(50)

    const afterDisconnect = new TestClient()
    await afterDisconnect.connect(socketPath)
    afterDisconnect.send({ subscribe: ['state.*'] })
    await Bun.sleep(50)
    expect(afterDisconnect.received).toHaveLength(0)

    lateSubscriber.close()
    afterDisconnect.close()
  })

  test('request/reply works across the socket via an in-process responder', async () => {
    const bus = root.get('bus') as Bus
    bus.subscribe('echo:upper', (message) => {
      bus.publish(message.replyTo as string, String(message.data).toUpperCase())
    })

    const caller = new TestClient()
    await caller.connect(socketPath)
    caller.send({ subscribe: ['reply.caller.*'] })
    await Bun.sleep(20)
    caller.send({ type: 'echo:upper', data: 'hello', replyTo: 'reply.caller.1' })
    await waitFor(() => caller.received.length >= 1)

    expect(caller.received[0]).toEqual({ type: 'reply.caller.1', data: 'HELLO' })
    caller.close()
  })
})
