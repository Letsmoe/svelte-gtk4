<script lang="ts">
  import { clamped } from './lib'
  import type { AirQualityCurrent } from './lib'

  // The index, its band and the position on the scale, in the two shapes the
  // card sizes need: stacked on a 2x2 card, and side by side on the wider ones,
  // where the strips below claim the lower half.

  const AGE_TICK_MS = 30_000
  const MINUTE_MS = 60_000
  const HOUR_MS = 60 * MINUTE_MS

  let { current, stacked }: { current: AirQualityCurrent; stacked: boolean } = $props()

  let now = $state(Date.now())

  const fraction = $derived(clamped(current.index / current.max))
  const age = $derived(describeAge(now - current.updatedAt))

  // The card states how old its reading is, so it has to re-render on a timer
  // even when nothing new arrives.
  $effect(() => {
    const timer = setInterval(() => {
      now = Date.now()
    }, AGE_TICK_MS)
    return () => {
      clearInterval(timer)
    }
  })

  function describeAge(elapsed: number): string {
    if (elapsed < MINUTE_MS) {
      return 'just now'
    }
    if (elapsed < HOUR_MS) {
      return `${Math.floor(elapsed / MINUTE_MS)} minutes ago`
    }
    return `${Math.floor(elapsed / HOUR_MS)} hours ago`
  }
</script>

{#snippet scaleBar()}
  <div
    class="relative h-2 rounded-full"
    style:background="linear-gradient(to right, var(--color-success), var(--color-warning),
      var(--color-error), var(--color-accent))"
  >
    <div
      class="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full
        border-2 border-base-100 bg-base-content"
      style:left="{fraction * 100}%"
    ></div>
  </div>
{/snippet}

{#if stacked}
  <div class="flex flex-1 flex-col justify-between">
    <div class="text-sm font-medium">Air Quality</div>
    <div class="text-5xl leading-tight font-light tabular-nums">{current.index}</div>
    <div class="min-w-0">
      <div class="truncate text-sm text-base-content/90">{current.category}</div>
      <div class="text-xs text-base-content/60">{age}</div>
    </div>
    {@render scaleBar()}
  </div>
{:else}
  <div class="flex flex-col gap-2">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-sm font-medium">Air Quality</div>
        <div class="text-5xl leading-tight font-light tabular-nums">{current.index}</div>
      </div>
      <div class="flex min-w-0 flex-col items-end text-right">
        <div class="truncate text-sm font-medium">{current.place}</div>
        <div class="truncate text-sm text-base-content/90">{current.category}</div>
        <div class="text-xs text-base-content/60">{age}</div>
      </div>
    </div>
    {@render scaleBar()}
  </div>
{/if}
