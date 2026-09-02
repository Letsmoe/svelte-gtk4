import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from '@neoworks/extension-system'
import { requireService } from '../lib/services.js'
import type { BusService } from '../lib/bus.js'

// systray: StatusNotifierItem tray icons. Owning
// org.kde.StatusNotifierWatcher needs D-Bus name ownership, exported objects
// and signal matches, which Bun does not speak, so the extension spawns the Go
// daemon (daemon/neoshell-trayd) as an effect — it dies with the plugin, and
// the host drops the daemon's retained topic when its socket closes.
//
//   systray.items                          retained by the daemon
//   systray:activate  {key, x, y}          consumed by the daemon
//   systray:secondary {key, x, y}
//   systray:context   {key, x, y}
//   systray:scroll    {key, delta, orientation}

interface SystrayConfig {
  daemonPath?: string
  hostSocketPath?: string
}

const systrayExtension: Plugin.Object<SystrayConfig | undefined> = {
  name: 'systray',
  inject: ['bus'],
  apply(context, config) {
    requireService<BusService>(context, 'bus')
    const daemonPath = resolveDaemonPath(config)
    if (!existsSync(daemonPath)) {
      throw new Error(`systray: daemon binary missing at ${daemonPath} (task build)`)
    }
    const socketArgs = socketArguments(config)
    context.effect(() => spawnDaemon(daemonPath, socketArgs))
  },
}

export default systrayExtension

function resolveDaemonPath(config: SystrayConfig | undefined): string {
  if (config !== undefined && config.daemonPath !== undefined) {
    return config.daemonPath
  }
  const extensionDir = dirname(fileURLToPath(import.meta.url))
  return join(extensionDir, 'daemon', 'neoshell-trayd')
}

function socketArguments(config: SystrayConfig | undefined): string[] {
  if (config !== undefined && config.hostSocketPath !== undefined) {
    return ['-socket', config.hostSocketPath]
  }
  return []
}

function spawnDaemon(daemonPath: string, args: string[]): () => void {
  const child = spawn(daemonPath, args, { detached: true, stdio: 'inherit' })
  return () => {
    killProcessGroup(child.pid)
  }
}

function killProcessGroup(pid: number | undefined): void {
  if (pid === undefined) {
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    // already gone
  }
}
