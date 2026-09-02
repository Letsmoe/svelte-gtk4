import { join } from 'node:path'
import type { Server } from 'bun'
import type { Plugin } from '@neoworks/extension-system'
import { optionalService, requireService } from '../services.js'
import type { Bus } from '../bus.js'
import { WireConnection } from '../wire.js'
import type { AssetsService } from './assets.js'

export interface HttpConfig {
  // Port to bind on 127.0.0.1; 0 picks a free one (the bound port is exposed
  // on the "http" service).
  port: number
  // Directory of extension bundles; <pluginsDir>/<id>/dist is served at
  // /plugins/<id>/. Unset disables serving.
  pluginsDir?: string
}

export interface HttpService {
  port: number
}

interface WsData {
  connection: WireConnection | null
}

// httpPlugin serves extension bundles over HTTP and exposes the bus to
// webviews over a WebSocket at /ws. Loopback only: the shell's surfaces run on
// this machine, and the bus drives the desktop.
export const httpPlugin: Plugin.Object<HttpConfig> = {
  name: 'http',
  inject: ['bus'],
  apply(context, config) {
    const bus = requireService<Bus>(context, 'bus')
    // Lazy lookups: these services may mount after (or without) this plugin.
    const lookups: ServiceLookups = {
      assets: () => optionalService<AssetsService>(context, 'assets'),
      pages: () => optionalService<PageService>(context, 'pages'),
    }
    const server = serveHttp(bus, config, lookups)
    context.effect(() => () => server.stop(true))
    if (server.port === undefined) {
      throw new Error('http: server bound without a TCP port')
    }
    context.provide('http', { port: server.port } satisfies HttpService)
  },
}

// PageService lets another plugin (the surface page) contribute whole routes.
export interface PageService {
  handle(url: URL): Promise<Response> | Response | null
}

interface ServiceLookups {
  assets: () => AssetsService | undefined
  pages: () => PageService | undefined
}

function serveHttp(bus: Bus, config: HttpConfig, lookups: ServiceLookups): Server<WsData> {
  return Bun.serve<WsData>({
    hostname: '127.0.0.1',
    port: config.port,
    fetch(request, server) {
      return routeRequest(request, server, config, lookups)
    },
    websocket: {
      open(ws) {
        ws.data.connection = new WireConnection(bus, (line) => {
          ws.send(line)
        })
      },
      message(ws, raw) {
        feedWebSocket(ws.data, raw)
      },
      close(ws) {
        closeWebSocket(ws.data)
      },
    },
  })
}

function routeRequest(
  request: Request,
  server: Server<WsData>,
  config: HttpConfig,
  lookups: ServiceLookups,
): Response | Promise<Response> | undefined {
  const url = new URL(request.url)
  if (url.pathname === '/ws') {
    return upgradeWebSocket(request, server)
  }
  if (url.pathname.startsWith('/plugins/')) {
    return servePluginFile(url.pathname, config.pluginsDir)
  }
  const delegated = delegateToServices(url, lookups)
  if (delegated !== null) {
    return delegated
  }
  return new Response('not found', { status: 404 })
}

function delegateToServices(
  url: URL,
  lookups: ServiceLookups,
): Response | Promise<Response> | null {
  const pages = lookups.pages()
  if (pages !== undefined) {
    const response = pages.handle(url)
    if (response !== null) {
      return response
    }
  }
  const assets = lookups.assets()
  if (assets !== undefined) {
    return assets.handle(url)
  }
  return null
}

function upgradeWebSocket(request: Request, server: Server<WsData>): Response | undefined {
  const data: WsData = { connection: null }
  if (server.upgrade(request, { data })) {
    return undefined
  }
  return new Response('websocket upgrade required', { status: 400 })
}

function feedWebSocket(data: WsData, raw: string | Buffer): void {
  if (data.connection === null) {
    return
  }
  // WebSocket frames arrive whole; terminate so the shared NDJSON path fires.
  data.connection.feed(raw.toString() + '\n')
}

function closeWebSocket(data: WsData): void {
  if (data.connection === null) {
    return
  }
  data.connection.close()
  data.connection = null
}

async function servePluginFile(pathname: string, pluginsDir: string | undefined): Promise<Response> {
  if (pluginsDir === undefined) {
    return new Response('plugins disabled', { status: 404 })
  }
  const filePath = resolvePluginPath(pluginsDir, pathname)
  if (filePath === null) {
    return new Response('not found', { status: 404 })
  }
  const file = Bun.file(filePath)
  if (!(await file.exists())) {
    return new Response('not found', { status: 404 })
  }
  return new Response(file)
}

// resolvePluginPath maps /plugins/<id>/<rest> onto <pluginsDir>/<id>/dist/<rest>,
// rejecting ids and paths that could escape the plugins directory.
function resolvePluginPath(pluginsDir: string, pathname: string): string | null {
  const rest = pathname.slice('/plugins/'.length)
  const slashIndex = rest.indexOf('/')
  let id = rest
  let relative = ''
  if (slashIndex >= 0) {
    id = rest.slice(0, slashIndex)
    relative = rest.slice(slashIndex + 1)
  }
  if (id === '' || id.includes('..') || id.includes('\\')) {
    return null
  }
  if (relative === '') {
    relative = 'index.html'
  }
  if (relative.includes('..')) {
    return null
  }
  return join(pluginsDir, id, 'dist', relative)
}
