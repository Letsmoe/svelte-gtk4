<script lang="ts">
  import type { BusService } from '../../lib/bus'
  import type { ViewRegistry } from '../../host/plugins/views'
  import { MAX_UNIT_PX, sizePx, spanOf } from './freeform'

  // A gallery tile showing the real widget, mounted at its design size and
  // scaled down to fit. Previews are live because a widget's whole point is the
  // data in it — a greyed-out shape says nothing about which one to pick.
  //
  // The preview mounts under a "preview:" id, so anything a widget keys by
  // instance (its own settings, its own topic) stays separate from the cards
  // actually on the desktop.
  //
  // GTK CSS has no transform-origin, and a scaled widget keeps the allocation
  // it had — so the box is sized to what the scaled card occupies and the
  // wrapper clips whatever the transform pushes outside it.

  let {
    bus,
    registry,
    generation,
    type,
    size,
    width,
  }: {
    bus: BusService
    registry: ViewRegistry
    generation: number
    type: string
    size: string
    width: number
  } = $props()

  const View = $derived(viewFor(type, generation))
  const box = $derived(sizePx(MAX_UNIT_PX, spanOf(size)))
  const scale = $derived(width / box.width)

  function viewFor(widgetType: string, _generation: number) {
    return registry.resolve(widgetType)
  }

  // The scaled card is anchored to the wrapper's top-left by shifting it back
  // by half of what scaling about the centre moved it.
  function scaleCss(factor: number, unscaled: { width: number; height: number }): string {
    const dx = (unscaled.width * (factor - 1)) / 2
    const dy = (unscaled.height * (factor - 1)) / 2
    return `transform: translate(${dx}px, ${dy}px) scale(${factor});`
  }
</script>

<gtkbox
  class="gallery-preview"
  width={width}
  height={Math.round(box.height * scale)}
  halign="start"
  valign="start"
  clip
>
  {#if View !== undefined}
    <gtkbox
      width={box.width}
      height={box.height}
      halign="start"
      valign="start"
      css={scaleCss(scale, box)}
    >
      <View
        {bus}
        {registry}
        args={{ size, width: box.width, height: box.height }}
        id={`preview:${type}`}
      />
    </gtkbox>
  {/if}
</gtkbox>
