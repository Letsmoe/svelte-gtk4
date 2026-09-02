// BusClient is the webview's end of the host bus: the wire protocol from
// apps/host/src/wire.ts spoken over a WebSocket. Subscriptions are dispatched
// locally by pattern; the server additionally replays retained topics on
// subscribe.

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

// Keep in sync with matchesPattern in apps/host/src/bus.ts: exact match, or a
// trailing "*" matching any suffix.
export function matchesPattern(pattern: string, type: string): boolean {
  if (pattern === type) {
    return true
  }
  if (!pattern.endsWith('*')) {
    return false
  }
  return type.startsWith(pattern.slice(0, -1))
}

export class BusClient {
  private socket: WebSocket | null = null
  private readonly subscriptions = new Set<SubscriptionEntry>()
  private readonly sentPatterns = new Set<string>()
  // The server replays retained topics when it receives a subscribe frame, and
  // the wire has no unsubscribe — so a pattern is only ever sent once per
  // connection. Keeping the retained values here is what lets a second local
  // subscriber to an already-sent pattern still catch up.
  private readonly retained = new Map<string, BusMessage>()
  private nextReplyId = 1
  private readonly url: string
  private readonly replyPrefix: string

  // clientId namespaces reply topics so parallel clients never collide;
  // callers pass the surface id.
  constructor(url: string, clientId: string) {
    this.url = url
    this.replyPrefix = `reply.${clientId}`
  }

  async connect(): Promise<void> {
    const socket = new WebSocket(this.url)
    this.socket = socket
    socket.onmessage = (event) => {
      this.handleFrame(String(event.data))
    }
    await socketOpen(socket, this.url)
    this.sendRaw({ subscribe: [`${this.replyPrefix}.*`] })
  }

  close(): void {
    if (this.socket !== null) {
      this.socket.close()
    }
  }

  publish(type: string, data: unknown, replyTo?: string): void {
    this.sendRaw({ type, data, replyTo })
  }

  // retain stores the last value host-side; it is withdrawn automatically when
  // this connection closes, so a dead webview leaves nothing behind.
  retain(type: string, data: unknown): void {
    this.sendRaw({ type, data, retain: true })
  }

  // A pattern already sent gets its retained values from the local copy: asking
  // the server again would add a second subscription for the same socket and
  // every later message would arrive twice.
  subscribe(pattern: string, handler: BusHandler): () => void {
    const entry: SubscriptionEntry = { pattern, handler }
    this.subscriptions.add(entry)
    if (this.sentPatterns.has(pattern)) {
      this.replayRetained(entry)
    } else {
      this.sentPatterns.add(pattern)
      this.sendRaw({ subscribe: [pattern] })
    }
    return () => {
      this.subscriptions.delete(entry)
    }
  }

  private replayRetained(entry: SubscriptionEntry): void {
    for (const message of [...this.retained.values()]) {
      deliverIfMatching(entry, message)
    }
  }

  call(type: string, data: unknown, timeoutMs = 10_000): Promise<unknown> {
    const replyTo = `${this.replyPrefix}.${this.nextReplyId}`
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

  private handleFrame(raw: string): void {
    const message = parseFrame(raw)
    if (message === null) {
      return
    }
    if (message.retain === true) {
      this.retained.set(message.type, message)
    }
    for (const entry of [...this.subscriptions]) {
      deliverIfMatching(entry, message)
    }
  }

  private sendRaw(payload: Record<string, unknown>): void {
    if (this.socket === null) {
      throw new Error('bus: not connected')
    }
    this.socket.send(JSON.stringify(payload))
  }
}

function deliverIfMatching(entry: SubscriptionEntry, message: BusMessage): void {
  if (!matchesPattern(entry.pattern, message.type)) {
    return
  }
  entry.handler(message)
}

function parseFrame(raw: string): BusMessage | null {
  try {
    const parsed = JSON.parse(raw) as BusMessage
    if (typeof parsed.type !== 'string') {
      return null
    }
    return parsed
  } catch (error) {
    console.error('surface: bad bus frame:', error)
    return null
  }
}

function socketOpen(socket: WebSocket, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.onopen = () => resolve()
    socket.onerror = () => reject(new Error(`bus: websocket ${url} failed to connect`))
  })
}
