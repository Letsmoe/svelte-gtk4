<script lang="ts">
  let { start = 0 }: { start?: number } = $props()

  let count = $state(0)
  let typed = $state('')

  const total = $derived(start + count)
</script>

<gtkbox orientation="vertical">
  <gtklabel class="count">count {total}</gtklabel>
  <gtkbutton class="more" onclicked={() => (count += 1)}>More</gtkbutton>
  <gtkentry class="field" onchanged={(event: { target: { widget: { get_text(): string } } }) => (typed = event.target.widget.get_text())}></gtkentry>
  <gtklabel class="typed">{typed}</gtklabel>
  {#if total > 1}
    <gtklabel class="many">many</gtklabel>
  {/if}
  <gtkembed class="embedded" view="greeting" props={{ name: typed }}></gtkembed>
</gtkbox>
