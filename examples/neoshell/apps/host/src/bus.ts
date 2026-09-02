// Bus is the host's message distributor: subscribe, publish, request/reply,
// and retained topics. Data is opaque — the bus never parses payloads, never
// validates them, and knows no type names.

// BusMessage as delivered to subscribers. replyTo names the topic a responder
// publishes its reply on. retain marks a value the bus is holding, which is
// what lets a peer keep its own copy and hand it to a late subscriber of its
// own without asking for another replay.
export interface BusMessage {
  type: string
  data: unknown
  replyTo?: string
  retain?: boolean
}

export type BusHandler = (message: BusMessage) => void

interface SubscriptionEntry {
  pattern: string
  handler: BusHandler
}

// matchesPattern: exact match, or a trailing "*" matching any suffix
// ("hypr.*" matches "hypr.windows"; bare "*" matches everything).
export function matchesPattern(pattern: string, type: string): boolean {
  if (pattern === type) {
    return true
  }
  if (!pattern.endsWith('*')) {
    return false
  }
  return type.startsWith(pattern.slice(0, -1))
}

export class Bus {
  private readonly subscriptions = new Set<SubscriptionEntry>()
  private readonly retained = new Map<string, unknown>()
  private nextReplyId = 1

  publish(type: string, data: unknown, replyTo?: string): void {
    this.deliver({ type, data, replyTo })
  }

  // retain publishes and stores the last value so late subscribers catch up on
  // subscribe. The returned disposer withdraws the value — retained data dies
  // with its owner, like every other registration.
  retain(type: string, data: unknown): () => void {
    this.retained.set(type, data)
    this.deliver({ type, data, retain: true })
    return () => {
      this.retained.delete(type)
    }
  }

  private deliver(message: BusMessage): void {
    for (const entry of this.subscriptions) {
      deliverIfMatching(entry, message)
    }
  }

  subscribe(pattern: string, handler: BusHandler): () => void {
    const entry: SubscriptionEntry = { pattern, handler }
    this.subscriptions.add(entry)
    this.replayRetained(entry)
    return () => {
      this.subscriptions.delete(entry)
    }
  }

  // call publishes with a fresh reply topic and resolves with the first
  // message published there.
  call(type: string, data: unknown, timeoutMs = 10_000): Promise<unknown> {
    const replyTo = `reply.host.${this.nextReplyId}`
    this.nextReplyId += 1
    return new Promise((resolve, reject) => {
      this.awaitReply(replyTo, type, timeoutMs, resolve, reject)
      this.publish(type, data, replyTo)
    })
  }

  private awaitReply(
    replyTo: string,
    type: string,
    timeoutMs: number,
    resolve: (data: unknown) => void,
    reject: (error: Error) => void,
  ): void {
    const unsubscribe = this.subscribe(replyTo, (message) => {
      unsubscribe()
      clearTimeout(timer)
      resolve(message.data)
    })
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`bus: call "${type}" timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  }

  private replayRetained(entry: SubscriptionEntry): void {
    for (const [type, data] of this.retained) {
      deliverIfMatching(entry, { type, data, retain: true })
    }
  }
}

function deliverIfMatching(entry: SubscriptionEntry, message: BusMessage): void {
  if (!matchesPattern(entry.pattern, message.type)) {
    return
  }
  entry.handler(message)
}
