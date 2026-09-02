<script lang="ts">
  import { weatherIcon } from './lib'
  import type { HourEntry } from './lib'

  // The next few hours as evenly spread columns. The unit symbol stays on the
  // headline temperature above: repeating it six times reads as noise at this
  // size, and the degree sign carries the rest.
  //
  // `homogeneous` is what `flex-1` on every column was — GTK spreads the row
  // evenly without each column having to ask.

  const ICON_PIXELS = 20

  let { hours }: { hours: HourEntry[] } = $props()
</script>

<gtkbox class="card-strip" orientation="horizontal" homogeneous>
  {#each hours as hour (hour.label)}
    <gtkbox orientation="vertical" spacing={2}>
      <gtklabel class="card-strip-label" halign="center">{hour.label}</gtklabel>
      <gtkicon
        icon={weatherIcon(hour.code, hour.isDay)}
        size={ICON_PIXELS}
        halign="center"
      ></gtkicon>
      <gtklabel class="card-strip-value" tabular halign="center">{hour.temperature}°</gtklabel>
    </gtkbox>
  {/each}
</gtkbox>
