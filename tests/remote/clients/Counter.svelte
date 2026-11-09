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
  <gtkscrolledwindow>
    {#if total > 1}
      <gtklabel class="swap-many">many</gtklabel>
    {:else}
      <gtklabel class="swap-few">few</gtklabel>
    {/if}
  </gtkscrolledwindow>
  <gtkbox class="sized" css="min-width: 30px; transform: translateX(4px) scale(1.02);"></gtkbox>
  <gtkbox class="smuggled" css="min-width: 30px; background-image: url(file:///etc/passwd)"></gtkbox>
  <gtkbox class="dragged" drag-files={['known', 'made-up']}></gtkbox>
  <gtkpicture class="known-picture" handle="known"></gtkpicture>
  <gtkpicture class="unknown-picture" handle="made-up"></gtkpicture>
</gtkbox>
