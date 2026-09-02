import type { Plugin } from '@neoworks/extension-system'
import { requireService } from '../services.js'
import type { Bus } from '../bus.js'
import { WireConnection } from '../wire.js'
import { serve } from '../../gjs/socket.js'

export interface UnixSocketConfig {
  socketPath: string
}

// unixSocketPlugin exposes the bus to local processes as NDJSON over a unix
// socket. Everything neoshell runs now lives in this process, so the socket is
// there for the outside world: `neoshell emit` bound to a compositor keybind,
// and any daemon an extension chooses to spawn.
export const unixSocketPlugin: Plugin.Object<UnixSocketConfig> = {
  name: 'unix-socket',
  inject: ['bus'],
  apply(context, config) {
    const bus = requireService<Bus>(context, 'bus')
    context.effect(() => listenUnix(bus, config.socketPath))
  },
}

function listenUnix(bus: Bus, socketPath: string): () => void {
  const connections = new Set<WireConnection>()
  const stop = serve(socketPath, (peer) => {
    const connection = new WireConnection(bus, (line) => peer.send(line))
    connections.add(connection)
    return {
      // The reader strips the newline the wire protocol delimits on, so it is
      // put back rather than teaching WireConnection a second framing.
      line(text) {
        connection.feed(text + '\n')
      },
      close() {
        connection.close()
        connections.delete(connection)
      },
    }
  })
  return () => {
    stop()
    for (const connection of connections) {
      connection.close()
    }
    connections.clear()
  }
}
