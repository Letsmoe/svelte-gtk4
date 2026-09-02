<script lang="ts">
  import { subscribeTo } from '../../lib/bus'
  import type { ViewProps } from '../../host/plugins/views'
  import { recordOf } from '../../lib/record'

  // Battery indicator: an outline with a level fill and a bolt while charging.
  // Renders nothing until system.battery delivers data (desktops without a
  // battery never publish it).
  //
  // The webview drew this as an inline SVG. GTK has no SVG in the markup, so
  // the same shape is three boxes — shell, fill, nub — and the paint lives in
  // the stylesheet where the rest of the bar's does.

  const TRACK_WIDTH = 18

  let { bus }: ViewProps = $props()

  let percent = $state(-1)
  let charging = $state(false)

  $effect(() =>
    subscribeTo(bus, 'system.battery', (message) => {
      const data = recordOf(message.data)
      if (typeof data.percent === 'number') {
        percent = Math.round(data.percent)
      }
      charging = data.charging === true
    }),
  )

  const fillWidth = $derived(Math.max(2, Math.round((percent / 100) * TRACK_WIDTH)))
  const fillClass = $derived(fillClassOf(percent, charging))

  function fillClassOf(level: number, isCharging: boolean): string {
    if (level >= 0 && level <= 15 && !isCharging) {
      return 'battery-fill low'
    }
    return 'battery-fill'
  }
</script>

{#if percent >= 0}
  <gtkbox class="battery" orientation="horizontal" spacing={6} valign="center">
    <gtklabel tabular>{percent}%</gtklabel>
    <gtkoverlay valign="center">
      <gtkbox class="battery-shell" orientation="horizontal" width={22} height={13} clip>
        <gtkbox class={fillClass} width={fillWidth} height={9} valign="center" halign="start"></gtkbox>
      </gtkbox>
      {#if charging}
        <gtklabel overlay class="battery-bolt" halign="center" valign="center">⚡</gtklabel>
      {/if}
    </gtkoverlay>
    <gtkbox class="battery-nub" width={2} height={5} valign="center"></gtkbox>
  </gtkbox>
{/if}
