import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { Context } from '@neoworks/extension-system'
import { assetsPlugin } from './plugins/assets.js'
import { busPlugin } from './plugins/bus.js'
import { configPlugin } from './plugins/config.js'
import { extensionsPlugin } from './plugins/extensions.js'
import { hotReloadPlugin } from './plugins/hotReload.js'
import { httpPlugin } from './plugins/http.js'
import { renderHostPlugin } from './plugins/renderHost.js'
import { surfacePagePlugin } from './plugins/surfacePage.js'
import { surfacesPlugin } from './plugins/surfaces.js'
import { unixSocketPlugin } from './plugins/unixSocket.js'
import { viewTreePlugin } from './plugins/viewTree.js'

// neoshell-host: the kernel's root context. Mounts the built-in runtime
// plugins — bus, config, transports, render host — and nothing feature-shaped.
// Runs alongside the Go core during migration, on its own port and socket.

function main(): void {
  const root = new Context()
  const extensionsDir = envString('NEOSHELL_EXTENSIONS', 'apps/extensions')
  root.plugin(busPlugin)
  root.plugin(configPlugin, { path: defaultConfigPath() })
  root.plugin(unixSocketPlugin, { socketPath: join(runtimeDir(), 'neoshell-host.sock') })
  root.plugin(httpPlugin, {
    port: envNumber('NEOSHELL_HOST_PORT', 9877),
    // Extension bundles are the plugin dirs: /plugins/<id>/ serves <ext>/dist.
    pluginsDir: envString('NEOSHELL_PLUGINS', extensionsDir),
  })
  root.plugin(assetsPlugin)
  root.plugin(surfacePagePlugin)
  root.plugin(surfacesPlugin)
  root.plugin(extensionsPlugin, { extensionsDir })
  root.plugin(viewTreePlugin, {
    extensionsDir,
    viewsDevOrigin: envString('NEOSHELL_VIEWS_DEV', ''),
  })
  root.plugin(hotReloadPlugin, { extensionsDir })
  mountRenderHostIfEnabled(root)
  installSignalHandlers(root)
  console.log('neoshell-host running')
}

// The host owns the render host by default; NEOSHELL_HOST_RENDER=0 runs
// headless (tests, remote development).
function mountRenderHostIfEnabled(root: Context): void {
  if (process.env.NEOSHELL_HOST_RENDER === '0') {
    return
  }
  root.plugin(renderHostPlugin, {
    binaryPath: envString('NEOSHELL_RENDER_BIN', 'apps/render-host/neoshell-render'),
    socketPath: join(runtimeDir(), 'neoshell-render.sock'),
  })
}

function installSignalHandlers(root: Context): void {
  const shutdown = () => {
    void root.fiber.dispose().then(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

function defaultConfigPath(): string {
  return join(homedir(), '.config', 'neoshell', 'config.json')
}

function runtimeDir(): string {
  const dir = process.env.XDG_RUNTIME_DIR
  if (dir !== undefined && dir !== '') {
    return dir
  }
  return `/run/user/${userInfo().uid}`
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') {
    return fallback
  }
  const value = Number(raw)
  if (Number.isNaN(value)) {
    return fallback
  }
  return value
}

function envString(name: string, fallback: string): string {
  const raw = process.env[name]
  if (raw === undefined || raw === '') {
    return fallback
  }
  return raw
}

main()
