import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

// Unix-socket clients and a line server, replacing Bun.connect and Bun.listen.
// Three shapes are needed: a one-shot request that reads to EOF (Hyprland's
// request IPC), an endless line stream that reconnects (Hyprland's event
// socket), and a server that accepts NDJSON peers (`neoshell emit` from a
// compositor keybind).

const encoder = new TextEncoder()

export interface LineConnection {
  send(line: string): void
  close(): void
}

// What a server hands back for each accepted peer: one call per received line,
// one when the peer goes away.
export interface PeerHandlers {
  line(line: string): void
  close(): void
}

// request writes one command and resolves with everything the peer sends back
// before closing. Hyprland answers exactly this way: one command per
// connection, reply, EOF.
export function request(socketPath: string, command: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const connection = connect(socketPath)
    if (connection === null) {
      reject(new Error(`socket: cannot connect to ${socketPath}`))
      return
    }
    writeAll(connection.get_output_stream(), command)
    readToEnd(connection, timeoutMs, resolve, reject)
  })
}

// streamLines follows a socket that stays open, reconnecting after every drop
// until the disposer runs — a compositor restarting must not kill the bridge.
export function streamLines(
  socketPath: string,
  onLine: (line: string) => void,
  reconnectDelayMs: number,
): () => void {
  const state: StreamState = { stopped: false, connection: null, retryTimer: null }
  openStream(socketPath, onLine, reconnectDelayMs, state)
  return () => {
    state.stopped = true
    if (state.retryTimer !== null) {
      clearTimeout(state.retryTimer)
    }
    closeQuietly(state.connection)
    state.connection = null
  }
}

// serve accepts NDJSON peers on a unix socket. The path is unlinked first: a
// crashed process leaves the node behind and binding would fail forever after.
export function serve(
  socketPath: string,
  accept: (peer: LineConnection) => PeerHandlers,
): () => void {
  GLib.unlink(socketPath)
  const service = new Gio.SocketService()
  try {
    service.add_address(
      Gio.UnixSocketAddress.new(socketPath),
      Gio.SocketType.STREAM,
      Gio.SocketProtocol.DEFAULT,
      null,
    )
  } catch (error) {
    console.error(`socket: cannot listen on ${socketPath}:`, error)
    return () => {}
  }
  const handler = service.connect('incoming', (_service, connection) => {
    acceptConnection(connection, accept)
    return true
  })
  service.start()
  return () => {
    service.disconnect(handler)
    service.stop()
    service.close()
    GLib.unlink(socketPath)
  }
}

interface StreamState {
  stopped: boolean
  connection: Gio.SocketConnection | null
  retryTimer: number | null
}

function acceptConnection(
  connection: Gio.SocketConnection,
  accept: (peer: LineConnection) => PeerHandlers,
): void {
  const input = new Gio.DataInputStream({ base_stream: connection.get_input_stream() })
  const output = connection.get_output_stream()
  const state = { stopped: false }
  const peer: LineConnection = {
    send(line) {
      writeAll(output, line)
    },
    close() {
      state.stopped = true
      closeQuietly(connection)
    },
  }
  const handlers = accept(peer)
  pumpLines(
    input,
    state,
    (line) => handlers.line(line),
    () => {
      peer.close()
      handlers.close()
    },
  )
}

function openStream(
  socketPath: string,
  onLine: (line: string) => void,
  reconnectDelayMs: number,
  state: StreamState,
): void {
  if (state.stopped) {
    return
  }
  const connection = connect(socketPath)
  if (connection === null) {
    scheduleReconnect(socketPath, onLine, reconnectDelayMs, state)
    return
  }
  state.connection = connection
  const input = new Gio.DataInputStream({ base_stream: connection.get_input_stream() })
  pumpLines(input, state, onLine, () => {
    state.connection = null
    scheduleReconnect(socketPath, onLine, reconnectDelayMs, state)
  })
}

function scheduleReconnect(
  socketPath: string,
  onLine: (line: string) => void,
  reconnectDelayMs: number,
  state: StreamState,
): void {
  if (state.stopped) {
    return
  }
  state.retryTimer = setTimeout(() => {
    state.retryTimer = null
    openStream(socketPath, onLine, reconnectDelayMs, state)
  }, reconnectDelayMs)
}

function pumpLines(
  input: Gio.DataInputStream,
  state: { stopped: boolean },
  onLine: (line: string) => void,
  onEnd: () => void,
): void {
  if (state.stopped) {
    return
  }
  input.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, result) => {
    const line = finishLine(stream, result)
    if (state.stopped) {
      return
    }
    if (line === null) {
      onEnd()
      return
    }
    onLine(line)
    pumpLines(input, state, onLine, onEnd)
  })
}

// The request socket delivers its reply in however many chunks it likes and
// signals completion by closing, so the read runs to EOF rather than to a
// newline.
function readToEnd(
  connection: Gio.SocketConnection,
  timeoutMs: number,
  resolve: (value: string) => void,
  reject: (error: Error) => void,
): void {
  const chunks: string[] = []
  const input = new Gio.DataInputStream({ base_stream: connection.get_input_stream() })
  const state = { stopped: false }
  const timer = setTimeout(() => {
    state.stopped = true
    closeQuietly(connection)
    reject(new Error('socket: request timed out'))
  }, timeoutMs)
  pumpLines(
    input,
    state,
    (line) => chunks.push(line),
    () => {
      clearTimeout(timer)
      closeQuietly(connection)
      resolve(chunks.join('\n'))
    },
  )
}

function connect(socketPath: string): Gio.SocketConnection | null {
  if (!GLib.file_test(socketPath, GLib.FileTest.EXISTS)) {
    return null
  }
  try {
    return new Gio.SocketClient().connect(Gio.UnixSocketAddress.new(socketPath), null)
  } catch {
    return null
  }
}

function writeAll(stream: Gio.OutputStream, text: string): void {
  try {
    stream.write_all(encoder.encode(text), null)
  } catch (error) {
    console.error('socket: write failed:', error)
  }
}

function finishLine(stream: Gio.DataInputStream | null, result: Gio.AsyncResult): string | null {
  if (stream === null) {
    return null
  }
  try {
    const [line] = stream.read_line_finish_utf8(result)
    return line
  } catch {
    return null
  }
}

function closeQuietly(connection: Gio.SocketConnection | null): void {
  if (connection === null) {
    return
  }
  try {
    connection.close(null)
  } catch {
    // already gone
  }
}
