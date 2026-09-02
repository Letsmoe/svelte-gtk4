<script lang="ts">
  import { subscribeTo } from '../../lib/bus'
  import type { ViewProps } from '../../host/plugins/views'
  import { widgetBoxOf } from '../../lib/widget'
  import AirQualitySummary from './AirQualitySummary.svelte'
  import IndexStrip from './IndexStrip.svelte'
  import PollutantList from './PollutantList.svelte'
  import { currentOf } from './lib'
  import type { AirQualityCurrent } from './lib'

  // The desktop air quality card in the three widget sizes:
  //
  //   small (2x2)   the index, its band and the position on the scale
  //   medium (4x2)  the same laid out wide, plus the next hours
  //   large (4x4)   the same, plus the pollutants behind the index
  //
  // The size is a prop rather than something the card measures — see the
  // weather card for why the webview build had to observe its own box and this
  // one does not.
  //
  // One topic for the whole extension, not one per card: unlike weather, the
  // backend keeps a single location, so two air quality widgets show the same
  // reading.

  // What the scale bar has left once the card's padding has taken its share.
  const CARD_PADDING_PX = 28

  let { bus, args }: ViewProps = $props()

  let current = $state<AirQualityCurrent | null>(null)

  const box = $derived(widgetBoxOf(args))
  const trackWidth = $derived(Math.max(40, box.width - CARD_PADDING_PX))

  $effect(() =>
    subscribeTo(bus, 'airquality.current', (message) => {
      current = currentOf(message.data, Date.now())
    }),
  )
</script>

<gtkbox class="card" orientation="vertical" spacing={10} hexpand vexpand>
  {#if current === null}
    <gtkbox orientation="vertical" spacing={4}>
      <gtklabel class="card-title" halign="start">Air Quality</gtklabel>
      <gtklabel class="card-hint" halign="start" wrap xalign={0}>
        Set airquality.place in the neoshell config.
      </gtklabel>
    </gtkbox>
  {:else if box.size === 'small'}
    <AirQualitySummary {current} stacked={true} {trackWidth} />
  {:else if box.size === 'medium'}
    <AirQualitySummary {current} stacked={false} {trackWidth} />
    <gtkbox vexpand></gtkbox>
    <IndexStrip hours={current.hours} max={current.max} />
  {:else}
    <AirQualitySummary {current} stacked={false} {trackWidth} />
    <IndexStrip hours={current.hours} max={current.max} />
    <PollutantList pollutants={current.pollutants} />
  {/if}
</gtkbox>
