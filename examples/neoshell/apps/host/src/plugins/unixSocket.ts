import { unlinkSync } from 'node:fs'
import type { Socket } from 'bun'
import type { Plugin } from '@neoworks/extension-system'
import { requireService } from '../services.js'
import type { Bus } from '../bus.js'
import { WireConnection } from '../wire.js'

export interface UnixSocketConfig {
  socketPath: string
}

// unixSocketPlugin exposes the bus to local processes — extension daemons and
// the emit CLI — as NDJSON over a unix socket.
export const unixSocketPlugin: Plugin.Object<UnixSocketConfig> = {
  name: 'unix-socket',
  inject: ['bus'],
  apply(context, config) {
    const bus = requireService<Bus>(context, 'bus')
    context.effect(() => listenUnix(bus, config.socketPath))
  },
}

function listenUnix(bus: Bus, socketPath: string): () => void {
  removeStaleSocket(socketPath)
  const connections = new Map<Socket<undefined>, WireConnection>()
  const listener = Bun.listen<undefined>({
    unix: socketPath,
    socket: {
      open(socket) {
        connections.set(socket, connectionFor(bus, socket))
      },
      data(socket, chunk) {
        feedConnection(connections.get(socket), chunk)
      },
      close(socket) {
        closeConnection(connections.get(socket))
        connections.delete(socket)
      },
    },
  })
  return () => {
    listener.stop(true)
    removeStaleSocket(socketPath)
  }
}

function connectionFor(bus: Bus, socket: Socket<undefined>): WireConnection {
  return new WireConnection(bus, (line) => {
    socket.write(line)
  })
}

function feedConnection(connection: WireConnection | undefined, chunk: Buffer): void {
  if (connection === undefined) {
    return
  }
  connection.feed(chunk.toString())
}

function closeConnection(connection: WireConnection | undefined): void {
  if (connection === undefined) {
    return
  }
  connection.close()
}

function removeStaleSocket(socketPath: string): void {
  try {
    unlinkSync(socketPath)
  } catch {
    // an absent socket file is fine
  }
}
