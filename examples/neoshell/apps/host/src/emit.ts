import { userInfo } from 'node:os'
import { join } from 'node:path'

// neoshell-emit: publish one message onto the running host's bus, so a
// Hyprland keybind can run e.g. `neoshell-emit surface:toggle dock`. The
// optional second argument is the payload — valid JSON passes through, a
// bare string is wrapped as a JSON string.

function main(): void {
  const topic = process.argv[2]
  if (topic === undefined || topic === '') {
    console.error('usage: neoshell-emit <topic> [payload]')
    process.exit(2)
  }
  const payload = parsePayload(process.argv[3])
  void send(topic, payload)
}

function parsePayload(raw: string | undefined): unknown {
  if (raw === undefined || raw === '') {
    return undefined
  }
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

async function send(topic: string, payload: unknown): Promise<void> {
  const line = JSON.stringify({ type: topic, data: payload }) + '\n'
  try {
    const socket = await Bun.connect({
      unix: socketPath(),
      socket: {
        data() {},
      },
    })
    socket.write(line)
    socket.flush()
    socket.end()
  } catch (error) {
    console.error(`neoshell-emit ${topic}: ${error} (is the host running?)`)
    process.exit(1)
  }
}

function socketPath(): string {
  const dir = process.env.XDG_RUNTIME_DIR
  if (dir !== undefined && dir !== '') {
    return join(dir, 'neoshell-host.sock')
  }
  return join(`/run/user/${userInfo().uid}`, 'neoshell-host.sock')
}

main()
