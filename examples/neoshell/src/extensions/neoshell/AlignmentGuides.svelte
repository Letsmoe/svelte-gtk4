<script lang="ts">
  import type { Guide } from './freeform'

  // The lines that explain a snap while something is being dragged. They are
  // the desktop's only feedback that placement is free-form but not arbitrary,
  // so they are drawn over everything and never take a pointer.
  //
  // Each one is an overlay child of the desktop, stretched along its axis and
  // pushed to its position by a margin — GTK has no absolute positioning, and
  // an overlay child aligned to one edge with a margin is what stands in for
  // it everywhere on this surface.

  let { guides }: { guides: Guide[] } = $props()

  function keyOf(guide: Guide): string {
    return `${guide.vertical},${guide.position}`
  }
</script>

{#each guides as guide (keyOf(guide))}
  {#if guide.vertical}
    <gtkbox
      overlay
      class="alignment-guide"
      width={1}
      halign="start"
      valign="fill"
      margin-start={guide.position}
    ></gtkbox>
  {:else}
    <gtkbox
      overlay
      class="alignment-guide"
      height={1}
      halign="fill"
      valign="start"
      margin-top={guide.position}
    ></gtkbox>
  {/if}
{/each}
