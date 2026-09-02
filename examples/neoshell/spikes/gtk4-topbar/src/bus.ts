import GLib from 'gi://GLib'
import Gio from 'gi://Gio'

// NDJSON client for the neoshell host bus. Identical protocol to the one the
// webviews speak over the WebSocket — GJS has no WebSocket, so this rides the
// unix socket the host already exposes for extension daemons.

export interface BusMessage {
  type: string
  data: unknown
}

type Handler = (message: BusMessage) => void

export class BusClient {
  #output: Gio.OutputStream | null = null
  #input: Gio.DataInputStream | null = null
  #handlersByPattern = new Map<string, Handler[]>()
  #replyCounter = 0

  get connected(): boolean {
    return this.#output !== null
  }

  open(socketPath: string): boolean {
    const connection = openConnection(socketPath)
    if (connection === null) {
      return false
    }
    this.#output = connection.get_output_stream()
    this.#input = new Gio.DataInputStream({ base_stream: connection.get_input_stream() })
    this.#readNextLine()
    return true
  }

  subscribe(pattern: string, handler: Handler): void {
    const handlers = this.#handlersByPattern.get(pattern)
    if (handlers !== undefined) {
      handlers.push(handler)
      return
    }
    this.#handlersByPattern.set(pattern, [handler])
    this.#send({ subscribe: [pattern] })
  }

  publish(type: string, data: unknown): void {
    this.#send({ type, data })
  }

  // Fire-and-forget request: the spike never reads a reply back, but the host
  // still routes it as a function call rather than a broadcast.
  call(type: string, data: unknown): void {
    this.#replyCounter += 1
    this.#send({ type, data, replyTo: `r-${this.#replyCounter}` })
  }

  #send(message: unknown): void {
    if (this.#output === null) {
      return
    }
    this.#output.write_all(`${JSON.stringify(message)}\n`, null)
  }

  #readNextLine(): void {
    if (this.#input === null) {
      return
    }
    this.#input.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, result) => {
      const line = finishLine(stream, result)
      if (line === null) {
        return
      }
      this.#dispatch(line)
      this.#readNextLine()
    })
  }

  #dispatch(line: string): void {
    const message = parseMessage(line)
    if (message === null) {
      return
    }
    for (const [pattern, handlers] of this.#handlersByPattern) {
      deliverIfMatched(pattern, handlers, message)
    }
  }
}

function openConnection(socketPath: string): Gio.SocketConnection | null {
  if (!GLib.file_test(socketPath, GLib.FileTest.EXISTS)) {
    return null
  }
  try {
    const client = new Gio.SocketClient()
    return client.connect(Gio.UnixSocketAddress.new(socketPath), null)
  } catch (error) {
    logError(error as Error, `bus: connect to ${socketPath} failed`)
    return null
  }
}

function finishLine(stream: Gio.DataInputStream | null, result: Gio.AsyncResult): string | null {
  if (stream === null) {
    return null
  }
  try {
    const [line] = stream.read_line_finish_utf8(result)
    return line
  } catch (error) {
    logError(error as Error, 'bus: read failed')
    return null
  }
}

function parseMessage(line: string): BusMessage | null {
  try {
    const parsed = JSON.parse(line) as Partial<BusMessage>
    if (typeof parsed.type !== 'string') {
      return null
    }
    return { type: parsed.type, data: parsed.data }
  } catch {
    return null
  }
}

function deliverIfMatched(pattern: string, handlers: Handler[], message: BusMessage): void {
  if (!topicMatches(pattern, message.type)) {
    return
  }
  for (const handler of handlers) {
    handler(message)
  }
}

function topicMatches(pattern: string, topic: string): boolean {
  if (!pattern.endsWith('*')) {
    return pattern === topic
  }
  return topic.startsWith(pattern.slice(0, -1))
}

export function busSocketPath(): string {
  const runtimeDir = GLib.getenv('XDG_RUNTIME_DIR')
  if (runtimeDir !== null && runtimeDir !== '') {
    return `${runtimeDir}/neoshell-host.sock`
  }
  return `/run/user/${GLib.get_user_name()}/neoshell-host.sock`
}
