<script lang="ts">
  import WeatherIcon from './WeatherIcon.svelte'
  import type { DayEntry } from './lib'

  // One row per forecast day: the weekday, its condition, and the day's range
  // as a bar scaled against the whole list, so the rows read against each other
  // rather than each against itself.

  // A day whose high and low round to the same number would otherwise draw a
  // zero-width bar.
  const MIN_BAR_PERCENT = 6

  let { days, class: layoutClass = '' }: { days: DayEntry[]; class?: string } = $props()

  const scale = $derived(scaleOf(days))

  function scaleOf(entries: DayEntry[]): { low: number; span: number } {
    if (entries.length === 0) {
      return { low: 0, span: 0 }
    }
    const low = Math.min(...entries.map((entry) => entry.low))
    const high = Math.max(...entries.map((entry) => entry.high))
    return { low, span: high - low }
  }

  // Widening a flat day's bar would push it past the track when that day sits
  // at the top of the scale, so the bar is pulled back instead.
  function barOf(day: DayEntry): { left: number; width: number } {
    const width = Math.max(MIN_BAR_PERCENT, positionOf(day.high) - positionOf(day.low))
    return { left: Math.min(positionOf(day.low), 100 - width), width }
  }

  function positionOf(value: number): number {
    if (scale.span <= 0) {
      return 0
    }
    return ((value - scale.low) / scale.span) * 100
  }
</script>

<div class="flex flex-col justify-between {layoutClass}">
  {#each days as day (day.label)}
    {@const bar = barOf(day)}
    <div class="flex items-center gap-2">
      <div class="w-10 shrink-0 truncate text-sm text-base-content/70">{day.label}</div>
      <WeatherIcon code={day.code} isDay={true} class="h-5 w-6" />
      <div class="w-7 shrink-0 text-right text-sm tabular-nums text-base-content/60">
        {day.low}°
      </div>
      <div class="relative h-1 flex-1 rounded-full bg-base-content/15">
        <div
          class="absolute h-1 rounded-full bg-linear-to-r from-info to-warning"
          style:left="{bar.left}%" style:width="{bar.width}%"
        ></div>
      </div>
      <div class="w-7 shrink-0 text-sm tabular-nums">{day.high}°</div>
    </div>
  {/each}
</div>
