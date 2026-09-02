<script lang="ts">
  import type { BusLike } from './lib'

  // The bar clock. Clicking it toggles the quick settings tray, which is a
  // sibling top-level view — the bar only announces the intent.

  let { bus }: { bus: BusLike } = $props()

  const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
  const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })

  let now = $state(new Date())

  $effect(() => {
    const timer = setInterval(() => {
      now = new Date()
    }, 1000)
    return () => {
      clearInterval(timer)
    }
  })

  function toggleQuickSettings(): void {
    bus.publish('quicksettings:toggle', {})
  }
</script>

<button
  type="button"
  class="flex items-center gap-2 rounded-lg px-2 py-0.5 tabular-nums transition-colors
    hover:bg-base-content/10"
  aria-label="Quick settings"
  onclick={toggleQuickSettings}
>
  <span class="text-base-content/60">{DATE_FORMAT.format(now)}</span>
  <span>{TIME_FORMAT.format(now)}</span>
</button>
