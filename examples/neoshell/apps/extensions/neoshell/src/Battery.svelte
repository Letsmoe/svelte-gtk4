<script lang="ts">
  import { recordOf } from './lib'
  import type { BusLike } from './lib'

  // Battery indicator: outline with a level fill, a bolt while charging.
  // Renders nothing until system.battery delivers data (desktops without a
  // battery never publish it).

  let { bus }: { bus: BusLike } = $props()

  let percent = $state(-1)
  let charging = $state(false)

  $effect(() => {
    return bus.subscribe('system.battery', (message) => {
      const data = recordOf(message.data)
      if (typeof data.percent === 'number') {
        percent = Math.round(data.percent)
      }
      charging = data.charging === true
    })
  })

  const fillWidth = $derived(Math.max(2, Math.round((percent / 100) * 18)))
  const fillClass = $derived(fillClassOf(percent, charging))

  function fillClassOf(level: number, isCharging: boolean): string {
    if (level >= 0 && level <= 15 && !isCharging) {
      return 'fill-error'
    }
    return 'fill-current'
  }
</script>

{#if percent >= 0}
  <div class="flex items-center gap-1.5 text-base-content/80 tabular-nums">
    <span>{percent}%</span>
    <svg width="25" height="13" viewBox="0 0 25 13" fill="none" class="shrink-0">
      <rect x="0.5" y="0.5" width="21" height="12" rx="3" stroke="currentColor" stroke-opacity="0.5" />
      <rect x="2" y="2" width={fillWidth} height="9" rx="1.5" class={fillClass} />
      <path d="M23.5 4.5v4a2 2 0 0 0 0-4z" fill="currentColor" fill-opacity="0.5" />
      {#if charging}
        <path
          d="M12.5 2.2 9 7h2.6l-1.6 4.6L13.5 6h-2.6z"
          fill="var(--color-base-100)"
          stroke="currentColor"
          stroke-width="0.75"
        />
      {/if}
    </svg>
  </div>
{/if}
