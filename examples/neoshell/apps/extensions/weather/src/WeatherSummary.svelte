<script lang="ts">
  import WeatherIcon from './WeatherIcon.svelte'
  import { NO_TEMPERATURE } from './lib'
  import type { WeatherCurrent } from './lib'

  // The place, the temperature and the condition, in the two shapes the card
  // sizes need: stacked with the condition at the foot on a 2x2 card, and side
  // by side on the wider ones, where the strips below claim the lower half.

  let { current, stacked }: { current: WeatherCurrent; stacked: boolean } = $props()

  const showsRange = $derived(current.high !== NO_TEMPERATURE && current.low !== NO_TEMPERATURE)
</script>

{#snippet place()}
  <div class="flex items-center gap-1 text-sm font-medium">
    <span class="truncate">{current.place}</span>
    <svg viewBox="0 0 12 12" class="h-3 w-3 shrink-0" aria-hidden="true">
      <path d="M11 1L1 5.4l4.1 1.5L6.6 11z" fill="currentColor" />
    </svg>
  </div>
{/snippet}

{#snippet condition(iconClass: string)}
  <WeatherIcon code={current.code} isDay={current.isDay} class={iconClass} />
  <div class="mt-1 truncate text-sm leading-snug text-base-content/90">{current.description}</div>
  {#if showsRange}
    <div class="text-xs tabular-nums text-base-content/60">H:{current.high}° L:{current.low}°</div>
  {/if}
{/snippet}

{#if stacked}
  <div class="flex flex-1 flex-col justify-between">
    <div class="min-w-0">
      {@render place()}
      <div class="text-5xl leading-tight font-light tabular-nums">
        {current.temperature}{current.unit}
      </div>
    </div>
    <div class="min-w-0">
      {@render condition('h-9 w-11')}
    </div>
  </div>
{:else}
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      {@render place()}
      <div class="text-5xl leading-tight font-light tabular-nums">
        {current.temperature}{current.unit}
      </div>
    </div>
    <div class="flex min-w-0 flex-col items-end text-right">
      {@render condition('h-8 w-10')}
    </div>
  </div>
{/if}
