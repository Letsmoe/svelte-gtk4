<script lang="ts">
  import { colourAt } from './lib'
  import type { PollutantEntry } from './lib'

  // One row per pollutant: its concentration, and how much of the WHO guideline
  // that is as a bar. The bars share the card's scale colours, so a row that
  // approaches its guideline reddens the way the index above it does.

  // A trace reading would otherwise draw an invisible bar, leaving the row
  // looking like it has no measurement at all.
  const MIN_BAR_PERCENT = 3

  let {
    pollutants,
    class: layoutClass = '',
  }: { pollutants: PollutantEntry[]; class?: string } = $props()

  // The concentrations share a unit, so it belongs over the column once rather
  // than on every row.
  const unit = $derived(unitOf(pollutants))

  function unitOf(entries: PollutantEntry[]): string {
    if (entries.length === 0) {
      return ''
    }
    return entries[0].unit
  }

  function widthOf(pollutant: PollutantEntry): number {
    return Math.max(MIN_BAR_PERCENT, pollutant.share * 100)
  }
</script>

<div class="flex flex-col justify-between {layoutClass}">
  <div class="flex items-center gap-2 text-xs text-base-content/50">
    <div class="flex-1">Pollutants</div>
    <div class="w-14 shrink-0 text-right">{unit}</div>
  </div>
  {#each pollutants as pollutant (pollutant.label)}
    <div class="flex items-center gap-2">
      <div class="w-12 shrink-0 truncate text-sm text-base-content/70">{pollutant.label}</div>
      <div class="relative h-1 flex-1 rounded-full bg-base-content/15">
        <div
          class="absolute h-1 rounded-full"
          style:width="{widthOf(pollutant)}%" style:background="{colourAt(pollutant.share)}"
        ></div>
      </div>
      <div class="w-14 shrink-0 text-right text-sm tabular-nums">{pollutant.value}</div>
    </div>
  {/each}
</div>
