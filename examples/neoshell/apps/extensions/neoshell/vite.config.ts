import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

// Builds the views module the layer webviews import at runtime:
// dist/views.js (ES module, svelte bundled) + dist/views.css.
export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: 'src/views.ts',
      formats: ['es'],
      fileName: () => 'views.js',
    },
    rollupOptions: {
      output: {
        assetFileNames: 'views[extname]',
      },
    },
  },
})
