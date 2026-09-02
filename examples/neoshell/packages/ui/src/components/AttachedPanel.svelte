<script lang="ts">
  import type { Snippet } from "svelte";

  const {
    left,
    right,
    children,
  }: { left: boolean; right: boolean; children: Snippet } = $props();
</script>

<div>
  {#if left}
    <div class="inner-corner-left"></div>
  {/if}
  {@render children()}
  {#if right}
    <div class="inner-corner-right"></div>
  {/if}
</div>

<style>
  @reference "tailwindcss";
  @reference "../../style/main.css";
  .inner-corner-left {
    position: absolute;
    top: 0;
    right: 100%;
    width: 12px;
    height: 12px;
    background: radial-gradient(
      circle at 0% 100%,
      transparent 12px,
      var(--color-base) 12px
    );
  }
  .inner-corner-right {
    position: absolute;
    top: 0;
    left: 100%;
    width: 12px;
    height: 12px;
    background: radial-gradient(
      circle at 100% 100%,
      transparent 12px,
      var(--color-base) 12px
    );
  }
</style>
