import { describe, expect, test } from 'bun:test'
import { BusClient, matchesPattern } from '../src/busClient.js'
import type { BusMessage } from '../src/busClient.js'

// The client is exercised through its frame handler rather than a socket: what
// matters here is how it dispatches and what it remembers, not the transport.
function clientWithFrames(frames: BusMessage[]): BusClient {
  const client = new BusClient('ws://127.0.0.1:0', 'test')
  const sent: string[] = []
  // The socket is never opened in these tests, so outgoing frames are collected
  // instead of written.
  Object.assign(client, { sendRaw: (frame: unknown) => sent.push(JSON.stringify(frame)) })
  for (const frame of frames) {
    ;(client as unknown as { handleFrame(raw: string): void }).handleFrame(JSON.stringify(frame))
  }
  return client
}

describe('pattern matching', () => {
  test('matches the host: exact, or a trailing wildcard', () => {
    expect(matchesPattern('a.b', 'a.b')).toBe(true)
    expect(matchesPattern('a.b', 'a.c')).toBe(false)
    expect(matchesPattern('a.*', 'a.anything')).toBe(true)
    expect(matchesPattern('*', 'anything')).toBe(true)
  })
})

// The wire has no unsubscribe, so a pattern is sent to the host once per
// connection and the host only replays retained values when it receives that
// frame. A view that unmounts and mounts again — a gallery preview, a panel
// reopened — would otherwise never see the retained value again.
describe('retained values across a re-subscribe', () => {
  test('a second subscriber to an already-sent pattern still catches up', () => {
    const client = clientWithFrames([{ type: 'weather.current', data: 'v1', retain: true }])

    const first: unknown[] = []
    const unsubscribe = client.subscribe('weather.current', (message) => first.push(message.data))
    unsubscribe()

    const second: unknown[] = []
    client.subscribe('weather.current', (message) => second.push(message.data))

    expect(second).toEqual(['v1'])
  })

  test('an ordinary event is not replayed to a later subscriber', () => {
    const client = clientWithFrames([{ type: 'timer.fired', data: 1 }])

    const seen: unknown[] = []
    client.subscribe('timer.fired', () => seen.push(1))
    client.subscribe('timer.fired', () => seen.push(2))

    expect(seen).toEqual([])
  })

  test('the newest retained value is the one replayed', () => {
    const client = clientWithFrames([
      { type: 'weather.current', data: 'v1', retain: true },
      { type: 'weather.current', data: 'v2', retain: true },
    ])

    const seen: unknown[] = []
    client.subscribe('weather.current', () => {})
    client.subscribe('weather.current', (message) => seen.push(message.data))

    expect(seen).toEqual(['v2'])
  })

  test('a wildcard subscriber catches up on every retained topic it covers', () => {
    const client = clientWithFrames([
      { type: 'weather.current/a', data: 'a', retain: true },
      { type: 'weather.current/b', data: 'b', retain: true },
      { type: 'other.topic', data: 'x', retain: true },
    ])

    const seen: unknown[] = []
    client.subscribe('weather.*', () => {})
    client.subscribe('weather.*', (message) => seen.push(message.data))

    expect(seen).toEqual(['a', 'b'])
  })

  test('a live delivery still reaches every subscriber exactly once', () => {
    const client = clientWithFrames([])
    const seen: unknown[] = []
    client.subscribe('weather.current', () => seen.push('first'))
    client.subscribe('weather.current', () => seen.push('second'))
    ;(client as unknown as { handleFrame(raw: string): void }).handleFrame(
      JSON.stringify({ type: 'weather.current', data: 'v1', retain: true }),
    )

    expect(seen).toEqual(['first', 'second'])
  })
})
