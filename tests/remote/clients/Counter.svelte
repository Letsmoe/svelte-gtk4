<script lang="ts">
  let { start = 0, onmore }: { start?: number; onmore?: (count: number) => void } = $props()

  let count = $state(0)
  let typed = $state('')

  const total = $derived(start + count)

  function more(): void {
    count += 1
    if (onmore !== undefined) {
      onmore(count)
    }
  }
</script>

<gtkbox orientation="vertical">
  <gtklabel class="count">count {total}</gtklabel>
  <gtkbutton class="more" onclicked={more}>More</gtkbutton>
  <gtkentry class="field" onchanged={(event: { target: { widget: { get_text(): string } } }) => (typed = event.target.widget.get_text())}></gtkentry>
  <gtklabel class="typed">{typed}</gtklabel>
  {#if total > 1}
    <gtklabel class="many">many</gtklabel>
  {/if}
  <gtkembed class="embedded" view="greeting" props={{ name: typed }}></gtkembed>
  <gtkpicture class="known-picture" handle="known"></gtkpicture>
  <gtkpicture class="unknown-picture" handle="made-up"></gtkpicture>
</gtkbox>
