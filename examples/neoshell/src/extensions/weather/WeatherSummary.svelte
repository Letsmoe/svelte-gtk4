<script lang="ts">
  import { NO_TEMPERATURE, weatherIcon } from './lib'
  import type { WeatherCurrent } from './lib'

  // The place, the temperature and the condition, in the two shapes the card
  // sizes need: stacked with the condition at the foot on a 2x2 card, and side
  // by side on the wider ones, where the strips below claim the lower half.
  //
  // The webview build shared the two arrangements through snippets. GTK needs
  // different alignment on each half as well, so the two are spelled out —
  // a snippet taking four alignment props reads worse than the duplication.

  const ICON_LARGE = 36
  const ICON_SMALL = 32

  let { current, stacked }: { current: WeatherCurrent; stacked: boolean } = $props()

  const showsRange = $derived(current.high !== NO_TEMPERATURE && current.low !== NO_TEMPERATURE)
  const icon = $derived(weatherIcon(current.code, current.isDay))
</script>

{#if stacked}
  <gtkbox class="card-summary" orientation="vertical" spacing={6} vexpand>
    <gtkbox orientation="horizontal" spacing={4}>
      <gtklabel class="card-place" halign="start" ellipsize="end">{current.place}</gtklabel>
    </gtkbox>
    <gtklabel class="card-reading" tabular halign="start">
      {current.temperature}{current.unit}
    </gtklabel>
    <gtkbox orientation="vertical" spacing={2} valign="end" vexpand>
      <gtkicon {icon} size={ICON_LARGE} halign="start"></gtkicon>
      <gtklabel class="card-condition" halign="start" ellipsize="end">
        {current.description}
      </gtklabel>
      {#if showsRange}
        <gtklabel class="card-range" tabular halign="start">
          H:{current.high}° L:{current.low}°
        </gtklabel>
      {/if}
    </gtkbox>
  </gtkbox>
{:else}
  <gtkbox class="card-summary" orientation="horizontal" spacing={12}>
    <gtkbox orientation="vertical" hexpand halign="start">
      <gtklabel class="card-place" halign="start" ellipsize="end">{current.place}</gtklabel>
      <gtklabel class="card-reading" tabular halign="start">
        {current.temperature}{current.unit}
      </gtklabel>
    </gtkbox>
    <gtkbox orientation="vertical" spacing={2} halign="end">
      <gtkicon {icon} size={ICON_SMALL} halign="end"></gtkicon>
      <gtklabel class="card-condition" halign="end" ellipsize="end">
        {current.description}
      </gtklabel>
      {#if showsRange}
        <gtklabel class="card-range" tabular halign="end">
          H:{current.high}° L:{current.low}°
        </gtklabel>
      {/if}
    </gtkbox>
  </gtkbox>
{/if}
