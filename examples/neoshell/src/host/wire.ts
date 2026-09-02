import type { Bus } from './bus.js'

// WireMessage is one JSON message from a connected peer — the unix socket
// (NDJSON lines) and the WebSocket (one message per frame) carry the same
// shape. A message either publishes (type set) or subscribes (subscribe set).
export interface WireMessage {
  type?: string
  data?: unknown
  retain?: boolean
  replyTo?: string
  subscribe?: string[]
}

export type WireWriter = (line: string) => void

// WireConnection adapts one peer to the bus and tracks everything the peer
// registered — subscriptions and retained values — so a disconnect reverts
// it all.
export class WireConnection {
  private buffer = ''
  private readonly cleanups: Array<() => void> = []
  private readonly bus: Bus
  private readonly write: WireWriter

  constructor(bus: Bus, write: WireWriter) {
    this.bus = bus
    this.write = write
  }

  // feed consumes a raw chunk from the peer and handles every complete
  // newline-terminated message in it.
  feed(chunk: string): void {
    this.buffer += chunk
    const parts = this.buffer.split('\n')
    this.buffer = parts[parts.length - 1]
    for (const line of parts.slice(0, -1)) {
      this.handleLine(line)
    }
  }

  close(): void {
    for (const cleanup of this.cleanups) {
      cleanup()
    }
    this.cleanups.length = 0
  }

  private handleLine(line: string): void {
    if (line.trim() === '') {
      return
    }
    const message = parseWireMessage(line)
    if (message === null) {
      return
    }
    this.dispatch(message)
  }

  private dispatch(message: WireMessage): void {
    if (Array.isArray(message.subscribe)) {
      this.addSubscriptions(message.subscribe)
      return
    }
    if (message.type === undefined) {
      return
    }
    if (message.retain === true) {
      this.cleanups.push(this.bus.retain(message.type, message.data))
      return
    }
    this.bus.publish(message.type, message.data, message.replyTo)
  }

  private addSubscriptions(patterns: string[]): void {
    for (const pattern of patterns) {
      this.cleanups.push(this.subscribeAndForward(pattern))
    }
  }

  private subscribeAndForward(pattern: string): () => void {
    return this.bus.subscribe(pattern, (message) => {
      this.write(JSON.stringify(message) + '\n')
    })
  }
}

function parseWireMessage(line: string): WireMessage | null {
  try {
    return JSON.parse(line) as WireMessage
  } catch (error) {
    console.error('host: bad wire message:', error)
    return null
  }
}
