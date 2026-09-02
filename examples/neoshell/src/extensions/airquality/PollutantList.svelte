<script lang="ts">
  import { bandOf } from './lib'
  import type { PollutantEntry } from './lib'

  // One row per pollutant: its concentration, and how much of the WHO guideline
  // that is as a bar. The bars share the card's scale bands, so a row that
  // approaches its guideline reddens the way the index above it does.
  //
  // A share of a track is exactly what a Gtk.LevelBar draws, so the row needs
  // none of the pixel arithmetic the day list and the scale bar do.

  let { pollutants }: { pollutants: PollutantEntry[] } = $props()

  // The concentrations share a unit, so it belongs over the column once rather
  // than on every row.
  const unit = $derived(unitOf(pollutants))

  function unitOf(entries: PollutantEntry[]): string {
    if (entries.length === 0) {
      return ''
    }
    return entries[0].unit
  }

  function barClass(pollutant: PollutantEntry): string {
    return `aqi-level ${bandOf(pollutant.share)}`
  }
</script>

<gtkbox class="card-pollutants" orientation="vertical" vexpand>
  <gtkbox orientation="horizontal" spacing={8}>
    <gtklabel class="card-strip-label" hexpand halign="start">Pollutants</gtklabel>
    <gtklabel class="card-strip-label" width={52} halign="end">{unit}</gtklabel>
  </gtkbox>
  {#each pollutants as pollutant (pollutant.label)}
    <gtkbox orientation="horizontal" spacing={8} vexpand>
      <gtklabel class="card-day-label" width={44} halign="start" ellipsize="end">
        {pollutant.label}
      </gtklabel>
      <gtklevelbar
        class={barClass(pollutant)}
        orientation="horizontal"
        min={0}
        max={1}
        value={pollutant.share}
        hexpand
        valign="center"
      ></gtklevelbar>
      <gtklabel class="card-day-high" tabular width={52} halign="end">{pollutant.value}</gtklabel>
    </gtkbox>
  {/each}
</gtkbox>
