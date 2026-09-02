import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from '@neoworks/extension-system'
import { requireService } from '../lib/services.js'
import type { BusService } from '../lib/bus.js'

// notifications: the daemon escape hatch in action. Owning
// org.freedesktop.Notifications needs D-Bus, which Bun does not speak, so the
// extension spawns the Go daemon (daemon/neoshell-notifyd) as an effect — it
// dies with the plugin. The daemon talks straight to the host bus:
//
//   notifications.event             add/close events, published by the daemon
//   notification:action {id, key}   consumed by the daemon
//   notification:close  {id, reason}

interface NotificationsConfig {
  daemonPath?: string
  hostSocketPath?: string
}

const notificationsExtension: Plugin.Object<NotificationsConfig | undefined> = {
  name: 'notifications',
  inject: ['bus'],
  apply(context, config) {
    requireService<BusService>(context, 'bus')
    const daemonPath = resolveDaemonPath(config)
    if (!existsSync(daemonPath)) {
      throw new Error(`notifications: daemon binary missing at ${daemonPath} (task build)`)
    }
    const socketArgs = socketArguments(config)
    context.effect(() => spawnDaemon(daemonPath, socketArgs))
  },
}

export default notificationsExtension

function resolveDaemonPath(config: NotificationsConfig | undefined): string {
  if (config !== undefined && config.daemonPath !== undefined) {
    return config.daemonPath
  }
  const extensionDir = dirname(fileURLToPath(import.meta.url))
  return join(extensionDir, 'daemon', 'neoshell-notifyd')
}

function socketArguments(config: NotificationsConfig | undefined): string[] {
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
