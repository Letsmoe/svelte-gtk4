<script lang="ts">
  import { bandOf, clamped } from './lib'
  import type { HourEntry } from './lib'

  // The next few hours as columns, each a bar against a common track. Height
  // and colour both carry the index, so the shape of the strip reads before the
  // numbers under it do.
  //
  // The track is a fixed pixel run rather than a percentage: GTK CSS has no
  // percentage lengths, and a vertical bar needs the height in pixels anyway.

  const TRACK_HEIGHT = 28
  const BAR_WIDTH = 6
  // A clean hour would otherwise draw nothing at all, which reads as a gap in
  // the forecast rather than as good air.
  const MIN_BAR_PX = 3

  let { hours, max }: { hours: HourEntry[]; max: number } = $props()

  function heightOf(hour: HourEntry): number {
    return Math.round(Math.max(MIN_BAR_PX, clamped(hour.index / max) * TRACK_HEIGHT))
  }

  function fillClass(hour: HourEntry): string {
    return `aqi-bar ${bandOf(hour.index / max)}`
  }
</script>

<gtkbox class="card-strip" orientation="horizontal" homogeneous>
  {#each hours as hour (hour.label)}
    <gtkbox orientation="vertical" spacing={2}>
      <gtklabel class="card-strip-label" halign="center">{hour.label}</gtklabel>
      <gtkbox
        class="aqi-bar-track"
        orientation="vertical"
        width={BAR_WIDTH}
        height={TRACK_HEIGHT}
        halign="center"
        clip
      >
        <gtkbox vexpand></gtkbox>
        <gtkbox class={fillClass(hour)} height={heightOf(hour)} valign="end"></gtkbox>
      </gtkbox>
      <gtklabel class="card-strip-value" tabular halign="center">{hour.index}</gtklabel>
    </gtkbox>
  {/each}
</gtkbox>
