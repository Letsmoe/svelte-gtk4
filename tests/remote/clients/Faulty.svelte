<script lang="ts">
  // One view per way a client could try to take its host down.
  let { fault }: { fault: string } = $props()

  if (fault === 'throw') {
    throw new Error('this view throws while mounting')
  }

  if (fault === 'loop') {
    setTimeout(() => {
      for (;;) {
        // never yields
      }
    }, 50)
  }

  if (fault === 'memory') {
    const hoard: string[] = []
    setTimeout(() => {
      for (;;) {
        hoard.push('x'.repeat(1 << 20))
      }
    }, 50)
  }

  let rows = $state<number[]>([])
  if (fault === 'flood') {
    setInterval(() => {
      rows = Array.from({ length: 400 }, (_, index) => index + Math.random())
    }, 1)
  }

  // Past the host's limit of 64, short of overflowing the client's own stack.
  const depth = fault === 'deep' ? 80 : 0
</script>

{#snippet nested(level: number)}
  <gtkbox>
    {#if level > 0}
      {@render nested(level - 1)}
    {/if}
  </gtkbox>
{/snippet}

<gtkbox orientation="vertical">
  <gtklabel class="alive">{fault}</gtklabel>
  {#if fault === 'css'}
    <gtkbox css="window &#123; background: red; &#125;"></gtkbox>
  {/if}
  {#if fault === 'window'}
    <gtkwindow></gtkwindow>
  {/if}
  {#if fault === 'huge'}
    <gtkbox width={1000000000} height={1000000000}></gtkbox>
  {/if}
  {#if depth > 0}
    {@render nested(depth)}
  {/if}
  {#each rows as row (row)}
    <gtklabel>{row}</gtklabel>
  {/each}
</gtkbox>
