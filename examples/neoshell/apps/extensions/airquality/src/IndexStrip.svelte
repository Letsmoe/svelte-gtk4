<script lang="ts">
  import { clamped, colourAt } from './lib'
  import type { HourEntry } from './lib'

  // The next few hours as columns, each a bar against a common track. Height
  // and colour both carry the index, so the shape of the strip reads before the
  // numbers under it do.

  // A clean hour would otherwise draw nothing at all, which reads as a gap in
  // the forecast rather than as good air.
  const MIN_BAR_PERCENT = 8

  let {
    hours,
    max,
    class: layoutClass = '',
  }: { hours: HourEntry[]; max: number; class?: string } = $props()

  function heightOf(hour: HourEntry): number {
    return Math.max(MIN_BAR_PERCENT, clamped(hour.index / max) * 100)
  }
</script>

<div class="flex items-end justify-between gap-1 {layoutClass}">
  {#each hours as hour (hour.label)}
    <div class="flex min-w-0 flex-1 flex-col items-center gap-1">
      <div class="text-xs text-base-content/60">{hour.label}</div>
      <div class="flex h-7 w-1.5 items-end rounded-full bg-base-content/15">
        <div
          class="w-full rounded-full"
          style:height="{heightOf(hour)}%" style:background="{colourAt(hour.index / max)}"
        ></div>
      </div>
      <div class="text-sm tabular-nums">{hour.index}</div>
    </div>
  {/each}
</div>
