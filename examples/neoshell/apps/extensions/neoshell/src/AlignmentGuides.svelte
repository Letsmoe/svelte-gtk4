<script lang="ts">
  import type { Guide } from './freeform'

  // The lines that explain a snap while something is being dragged. They are
  // the desktop's only feedback that placement is free-form but not arbitrary,
  // so they are drawn over everything and never take a pointer.

  let { guides }: { guides: Guide[] } = $props()

  function keyOf(guide: Guide): string {
    return `${guide.vertical},${guide.position}`
  }
</script>

{#each guides as guide (keyOf(guide))}
  {#if guide.vertical}
    <div
      class="pointer-events-none absolute top-0 bottom-0 w-px bg-primary/70"
      style:left={`${guide.position}px`}
    ></div>
  {:else}
    <div
      class="pointer-events-none absolute right-0 left-0 h-px bg-primary/70"
      style:top={`${guide.position}px`}
    ></div>
  {/if}
{/each}
