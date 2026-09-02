<script lang="ts">
  import { recordOf } from './lib'
  import type { BusLike } from './lib'

  // The desktop background: the configured wallpaper served by the host, a
  // flat dark fill when none is set or it fails to load. The path only
  // cache-busts the URL — /wallpaper reads the config itself.

  let { bus }: { bus: BusLike } = $props()

  let wallpaperPath = $state('')
  let failed = $state(false)

  $effect(() => {
    return bus.subscribe('config', (message) => {
      const next = pathOf(message.data)
      if (next === wallpaperPath) {
        return
      }
      wallpaperPath = next
      failed = false
    })
  })

  function pathOf(snapshot: unknown): string {
    const appearance = recordOf(recordOf(snapshot).appearance)
    if (typeof appearance.wallpaper === 'string') {
      return appearance.wallpaper
    }
    return ''
  }
</script>

<div class="fixed inset-0 bg-base-300">
  {#if !failed}
    <img
      class="h-full w-full object-cover"
      src={`/wallpaper?v=${encodeURIComponent(wallpaperPath)}`}
      alt=""
      onerror={() => {
        failed = true
      }}
    />
  {/if}
</div>
