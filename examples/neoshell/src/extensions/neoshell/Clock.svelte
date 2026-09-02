<script lang="ts">
  import type { ViewProps } from '../../host/plugins/views'

  // The bar clock. Clicking it toggles the quick settings tray, which is a
  // sibling top-level view — the bar only announces the intent.

  let { bus }: ViewProps = $props()

  // SpiderMonkey ships full ICU, so the formatters port from the webview
  // build unchanged.
  const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
  const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })

  let now = $state(new Date())

  $effect(() => {
    const timer = setInterval(() => {
      now = new Date()
    }, 1000)
    return () => {
      clearInterval(timer)
    }
  })

  function toggleQuickSettings(): void {
    bus.publish('quicksettings:toggle', {})
  }
</script>

<gtkbutton
  class="clock"
  frame={false}
  tooltip="Quick settings"
  valign="center"
  onclicked={toggleQuickSettings}
>
  <gtkbox orientation="horizontal" spacing={8}>
    <gtklabel class="clock-date">{DATE_FORMAT.format(now)}</gtklabel>
    <gtklabel tabular>{TIME_FORMAT.format(now)}</gtklabel>
  </gtkbox>
</gtkbutton>
