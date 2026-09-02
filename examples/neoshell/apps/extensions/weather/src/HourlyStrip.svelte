<script lang="ts">
  import WeatherIcon from './WeatherIcon.svelte'
  import type { HourEntry } from './lib'

  // The next few hours as evenly spread columns. The unit symbol stays on the
  // headline temperature above: repeating it six times reads as noise at this
  // size, and the degree sign carries the rest.

  let { hours, class: layoutClass = '' }: { hours: HourEntry[]; class?: string } = $props()
</script>

<div class="flex items-end justify-between gap-1 {layoutClass}">
  {#each hours as hour (hour.label)}
    <div class="flex min-w-0 flex-1 flex-col items-center gap-1">
      <div class="text-xs text-base-content/60">{hour.label}</div>
      <WeatherIcon code={hour.code} isDay={hour.isDay} class="h-5 w-6" />
      <div class="text-sm tabular-nums">{hour.temperature}°</div>
    </div>
  {/each}
</div>
