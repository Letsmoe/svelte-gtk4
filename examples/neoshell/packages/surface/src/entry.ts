// Bundled by the host (Bun.build) and served as /runtime.js — the module the
// /surface page loads to become a live neoshell surface.
import { bootSurface } from './boot.js'

void bootSurface().catch((error) => {
  console.error('surface boot failed:', error)
})
