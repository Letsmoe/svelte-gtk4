<script lang="ts">
  import { MAX_UNIT_PX, sizePx, spanOf } from './freeform'
  import type { ViewRegistryLike } from './widgetCanvas'

  // A gallery tile showing the real widget, mounted at its design size and
  // scaled down to fit. Previews are live because a widget's whole point is the
  // data in it — a greyed-out shape says nothing about which one to pick.
  //
  // The preview mounts under a "preview:" id, so anything a widget keys by
  // instance (its own settings, its own topic) stays separate from the cards
  // actually on the desktop.

  let {
    ui,
    type,
    size,
    width,
  }: { ui: ViewRegistryLike; type: string; size: string; width: number } = $props()

  let host: HTMLElement | undefined = $state()

  const box = $derived(sizePx(MAX_UNIT_PX, spanOf(size)))
  const scale = $derived(width / box.width)

  $effect(() => {
    const element = host
    const factory = ui.resolve(type)
    if (element === undefined || factory === undefined) {
      return
    }
    const instance = factory(element, {}, `preview:${type}`)
    return () => instance.dispose()
  })
</script>

<div
  class="pointer-events-none overflow-hidden"
  style:width={`${width}px`}
  style:height={`${box.height * scale}px`}
>
  <div
    bind:this={host}
    style:width={`${box.width}px`}
    style:height={`${box.height}px`}
    style:transform={`scale(${scale})`}
    style:transform-origin="top left"
  ></div>
</div>
