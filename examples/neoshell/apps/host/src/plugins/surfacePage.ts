import { watch } from 'node:fs'
import { dirname } from 'node:path'
import type { Plugin } from '@neoworks/extension-system'
import { requireService } from '../services.js'
import type { Bus } from '../bus.js'
import { debounced, hotReloadEnabled } from './hotReload.js'
import type { PageService } from './http.js'

// surfacePagePlugin serves the two routes every webview boots from:
//
//   /surface?surface=<id>   the HTML shell (transparent, no chrome)
//   /runtime.js             the surface runtime, bundled from
//                           @neoshell/surface at host startup via Bun.build
//
// Bundling at startup keeps the repo free of a build step for the runtime —
// the host has the TS sources through its own node_modules. Under
// NEOSHELL_HOT the sources are watched and rebundled in place, and every
// surface is told to reload itself.

const SURFACE_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
  * { box-sizing: border-box; }
</style>
</head>
<body><script type="module" src="/runtime.js"></script></body>
</html>
`

export const surfacePagePlugin: Plugin.Object = {
  name: 'surface-page',
  inject: ['bus'],
  async apply(context) {
    const bus = requireService<Bus>(context, 'bus')
    const pages = new SurfacePages(await bundleSurfaceRuntime())
    context.provide('pages', pages)
    if (!hotReloadEnabled()) {
      return
    }
    context.effect(() =>
      watchRuntimeSources(
        debounced(() => {
          void rebuildRuntime(pages, bus)
        }),
      ),
    )
  },
}

class SurfacePages implements PageService {
  private runtimeSource: string

  constructor(runtimeSource: string) {
    this.runtimeSource = runtimeSource
  }

  replaceRuntime(runtimeSource: string): void {
    this.runtimeSource = runtimeSource
  }

  handle(url: URL): Response | null {
    if (url.pathname === '/surface') {
      return new Response(SURFACE_HTML, { headers: { 'Content-Type': 'text/html' } })
    }
    if (url.pathname === '/runtime.js') {
      return new Response(this.runtimeSource, {
        // The runtime is local and tiny, and a cached copy would survive a
        // hot reload; never let the webview hold one.
        headers: { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' },
      })
    }
    return null
  }
}

// A rebuild that fails leaves the previous runtime serving: saving a file
// mid-edit must not take every surface down.
async function rebuildRuntime(pages: SurfacePages, bus: Bus): Promise<void> {
  let source: string
  try {
    source = await bundleSurfaceRuntime()
  } catch (error) {
    console.error('surface-page: runtime rebuild failed, keeping the last good bundle:', error)
    return
  }
  pages.replaceRuntime(source)
  console.log('host: hot reload hot.surface')
  bus.publish('hot.surface', {})
}

function watchRuntimeSources(onChange: () => void): () => void {
  const sourceDir = dirname(runtimeEntryPath())
  try {
    const watcher = watch(sourceDir, { recursive: true }, () => onChange())
    watcher.on('error', (error) => {
      console.error(`surface-page: watch on ${sourceDir} failed, no runtime reload:`, error)
      watcher.close()
    })
    console.log(`host: hot reload watching ${sourceDir}`)
    return () => watcher.close()
  } catch (error) {
    console.error(`surface-page: cannot watch ${sourceDir}, no runtime reload:`, error)
    return () => {}
  }
}

// Resolve the package root, then its sibling entry module — subpath patterns
// through Bun.resolveSync are unreliable across versions.
function runtimeEntryPath(): string {
  const indexPath = Bun.resolveSync('@neoshell/surface', import.meta.dir)
  return indexPath.replace(/index\.ts$/, 'entry.ts')
}

async function bundleSurfaceRuntime(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [runtimeEntryPath()],
    target: 'browser',
  })
  if (!result.success || result.outputs.length === 0) {
    throw new Error(`surface-page: runtime bundle failed: ${result.logs.join('\n')}`)
  }
  return result.outputs[0].text()
}
