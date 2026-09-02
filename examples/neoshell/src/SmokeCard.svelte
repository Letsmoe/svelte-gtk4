<script lang="ts">
  import type { ViewProps } from './host/plugins/views'

  // A stand-in widget for the smoke harness: the gallery previews whatever the
  // registry holds for a catalog entry's type, and a preview of nothing would
  // build none of the scaling the real one goes through.

  let { id }: ViewProps = $props()
</script>

<gtkbox class="qs-details" orientation="vertical" spacing={4} hexpand vexpand>
  <gtklabel class="qs-page-title" halign="start">Smoke card</gtklabel>
  <gtklabel class="qs-row-note" halign="start" ellipsize="end">{id}</gtklabel>
</gtkbox>
