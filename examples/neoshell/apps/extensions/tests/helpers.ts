import type { Plugin } from '@neoworks/extension-system'
import type { BusMessage } from '../lib/bus.js'

// FakeBus: in-memory bus with exact-match dispatch — bundled extensions
// subscribe exact function names and reply to exact reply topics. Retained
// values and published messages are inspectable.
export class FakeBus {
  readonly retained = new Map<string, unknown>()
  readonly published: BusMessage[] = []
  private readonly handlers = new Map<string, Set<(message: BusMessage) => void>>()
  private nextReplyId = 1

  publish(type: string, data: unknown, replyTo?: string): void {
    this.published.push({ type, data, replyTo })
    const set = this.handlers.get(type)
    if (set === undefined) {
      return
    }
    for (const handler of [...set]) {
      handler({ type, data, replyTo })
    }
  }

  retain(type: string, data: unknown): () => void {
    this.retained.set(type, data)
    return () => {
      this.retained.delete(type)
    }
  }

  subscribe(pattern: string, handler: (message: BusMessage) => void): () => void {
    let set = this.handlers.get(pattern)
    if (set === undefined) {
      set = new Set()
      this.handlers.set(pattern, set)
    }
    set.add(handler)
    return () => {
      set.delete(handler)
    }
  }

  call(type: string, data: unknown): Promise<unknown> {
    const replyTo = `reply.test.${this.nextReplyId}`
    this.nextReplyId += 1
    return new Promise((resolve) => {
      const unsubscribe = this.subscribe(replyTo, (message) => {
        unsubscribe()
        resolve(message.data)
      })
      this.publish(type, data, replyTo)
    })
  }
}

export function busProvider(bus: FakeBus): Plugin.Object {
  return {
    name: 'fake-bus',
    apply(context) {
      context.provide('bus', bus)
    },
  }
}

export async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('waitFor timed out')
    }
    await Bun.sleep(10)
  }
}
