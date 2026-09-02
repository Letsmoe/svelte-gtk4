<script lang="ts">
  import { clamped } from './lib'
  import type { AirQualityCurrent } from './lib'

  // The index, its band and the position on the scale, in the two shapes the
  // card sizes need: stacked on a 2x2 card, and side by side on the wider ones,
  // where the strips below claim the lower half.

  const AGE_TICK_MS = 30_000
  const MINUTE_MS = 60_000
  const HOUR_MS = 60 * MINUTE_MS
  const KNOB_PX = 14
  const TRACK_HEIGHT = 8

  let {
    current,
    stacked,
    trackWidth,
  }: { current: AirQualityCurrent; stacked: boolean; trackWidth: number } = $props()

  let now = $state(Date.now())

  const fraction = $derived(clamped(current.index / current.max))
  const age = $derived(describeAge(now - current.updatedAt))
  // The knob is centred on the reading, so it starts half its width earlier
  // and the track keeps it inside at both ends.
  const knobLeft = $derived(
    Math.round(Math.min(Math.max(0, fraction * trackWidth - KNOB_PX / 2), trackWidth - KNOB_PX)),
  )

  // The card states how old its reading is, so it has to re-render on a timer
  // even when nothing new arrives.
  $effect(() => {
    const timer = setInterval(() => {
      now = Date.now()
    }, AGE_TICK_MS)
    return () => {
      clearInterval(timer)
    }
  })

  function describeAge(elapsed: number): string {
    if (elapsed < MINUTE_MS) {
      return 'just now'
    }
    if (elapsed < HOUR_MS) {
      return `${Math.floor(elapsed / MINUTE_MS)} minutes ago`
    }
    return `${Math.floor(elapsed / HOUR_MS)} hours ago`
  }
</script>

<!-- The gradient track is painted by the stylesheet; the knob is an overlay
     child pushed along it by a margin, because GTK CSS has no percentage
     lengths to place it with. -->
{#snippet scaleBar()}
  <gtkoverlay height={KNOB_PX}>
    <gtkbox class="aqi-track" width={trackWidth} height={TRACK_HEIGHT} valign="center"></gtkbox>
    <gtkbox
      overlay
      class="aqi-knob"
      width={KNOB_PX}
      height={KNOB_PX}
      halign="start"
      valign="center"
      margin-start={knobLeft}
    ></gtkbox>
  </gtkoverlay>
{/snippet}

{#if stacked}
  <gtkbox class="card-summary" orientation="vertical" spacing={6} vexpand>
    <gtklabel class="card-title" halign="start">Air Quality</gtklabel>
    <gtklabel class="card-reading" tabular halign="start">{current.index}</gtklabel>
    <gtkbox orientation="vertical" valign="end" vexpand>
      <gtklabel class="card-condition" halign="start" ellipsize="end">{current.category}</gtklabel>
      <gtklabel class="card-range" halign="start">{age}</gtklabel>
    </gtkbox>
    {@render scaleBar()}
  </gtkbox>
{:else}
  <gtkbox class="card-summary" orientation="vertical" spacing={8}>
    <gtkbox orientation="horizontal" spacing={12}>
      <gtkbox orientation="vertical" hexpand halign="start">
        <gtklabel class="card-title" halign="start">Air Quality</gtklabel>
        <gtklabel class="card-reading" tabular halign="start">{current.index}</gtklabel>
      </gtkbox>
      <gtkbox orientation="vertical" halign="end">
        <gtklabel class="card-place" halign="end" ellipsize="end">{current.place}</gtklabel>
        <gtklabel class="card-condition" halign="end" ellipsize="end">{current.category}</gtklabel>
        <gtklabel class="card-range" halign="end">{age}</gtklabel>
      </gtkbox>
    </gtkbox>
    {@render scaleBar()}
  </gtkbox>
{/if}
