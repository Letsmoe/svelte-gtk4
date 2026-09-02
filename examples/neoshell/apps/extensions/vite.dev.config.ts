import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// The dev server behind `task dev`. One server for every extension: it serves
// <id>/src/views.ts straight from source, and the host points the layer
// webviews at it instead of at the built bundles under <id>/dist. A saved
// component is patched into the running surface over HMR, so nothing rebuilds
// and nothing remounts.
//
// Cross-origin by design — the surface page is served by the host on its own
// port and imports its view modules from here.

const EXTENSIONS_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(EXTENSIONS_DIR, '..', '..')

export default defineConfig({
  root: EXTENSIONS_DIR,
  plugins: [svelte(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    cors: true,
    // Views reach out of the extensions dir for the shared packages.
    fs: { allow: [REPO_ROOT] },
  },
})
