<script lang="ts">
  import { weatherIcon } from './lib'
  import type { DayEntry } from './lib'

  // One row per forecast day: the weekday, its condition, and the day's range
  // as a bar scaled against the whole list, so the rows read against each other
  // rather than each against itself.
  //
  // The webview placed the bar with percentage left/width. GTK CSS has no
  // percentage lengths, so the track is a fixed pixel run the card works out
  // from its own box, and the bar is a spacer followed by a fill — which also
  // spares an overlay whose margin would need the same arithmetic anyway.

  // A day whose high and low round to the same number would otherwise draw a
  // zero-width bar.
  const MIN_BAR_PX = 8
  const ICON_PIXELS = 20

  let { days, trackWidth }: { days: DayEntry[]; trackWidth: number } = $props()

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
    const width = Math.max(MIN_BAR_PX, positionOf(day.high) - positionOf(day.low))
    return { left: Math.round(Math.min(positionOf(day.low), trackWidth - width)), width: Math.round(width) }
  }

  function positionOf(value: number): number {
    if (scale.span <= 0) {
      return 0
    }
    return ((value - scale.low) / scale.span) * trackWidth
  }
</script>

<gtkbox class="card-days" orientation="vertical" vexpand>
  {#each days as day (day.label)}
    {@const bar = barOf(day)}
    <gtkbox orientation="horizontal" spacing={8} vexpand>
      <gtklabel class="card-day-label" width={36} halign="start" ellipsize="end">
        {day.label}
      </gtklabel>
      <gtkicon icon={weatherIcon(day.code, true)} size={ICON_PIXELS}></gtkicon>
      <gtklabel class="card-day-low" tabular width={26} halign="end">{day.low}°</gtklabel>
      <gtkbox class="card-day-track" orientation="horizontal" width={trackWidth} valign="center">
        <gtkbox width={bar.left}></gtkbox>
        <gtkbox class="card-day-fill" width={bar.width}></gtkbox>
      </gtkbox>
      <gtklabel class="card-day-high" tabular width={26} halign="end">{day.high}°</gtklabel>
    </gtkbox>
  {/each}
</gtkbox>
