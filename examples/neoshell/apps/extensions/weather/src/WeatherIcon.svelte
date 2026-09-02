<script lang="ts">
  // One glyph per WMO condition group, drawn rather than themed: an icon this
  // small has to stay legible over any wallpaper, and the shell serves no icon
  // font. Clear skies are the only condition that differs between day and
  // night.

  let {
    code,
    isDay,
    class: sizeClass = 'h-9 w-11',
  }: { code: number; isDay: boolean; class?: string } = $props()

  const glyph = $derived(glyphOf(code, isDay))

  function glyphOf(weatherCode: number, day: boolean): string {
    if (weatherCode <= 1) {
      return clearGlyph(day)
    }
    return cloudyGlyphOf(weatherCode)
  }

  function clearGlyph(day: boolean): string {
    if (day) {
      return 'sun'
    }
    return 'moon'
  }

  function cloudyGlyphOf(weatherCode: number): string {
    if (weatherCode <= 3) {
      return 'cloud'
    }
    if (weatherCode <= 48) {
      return 'fog'
    }
    if (weatherCode <= 67) {
      return 'rain'
    }
    if (weatherCode <= 77) {
      return 'snow'
    }
    if (weatherCode <= 82) {
      return 'rain'
    }
    if (weatherCode <= 86) {
      return 'snow'
    }
    return 'thunder'
  }
</script>

<svg viewBox="0 0 40 32" fill="none" class="shrink-0 {sizeClass}" aria-hidden="true">
  {#if glyph === 'sun'}
    <circle cx="20" cy="16" r="7" fill="currentColor" />
    <g stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M20 3v3M20 26v3M7 16h3M30 16h3M11 7l2 2M27 23l2 2M29 7l-2 2M13 23l-2 2" />
    </g>
  {:else if glyph === 'moon'}
    <path
      d="M25 6a11 11 0 1 0 8 12A9 9 0 0 1 25 6z"
      fill="currentColor"
    />
  {:else}
    <path
      d="M12 26a7 7 0 0 1-.6-14A9 9 0 0 1 29 13a6.5 6.5 0 0 1-.5 13z"
      fill="currentColor"
      fill-opacity="0.9"
    />
    {#if glyph === 'rain'}
      <g stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M14 28l-1 3M20 28l-1 3M26 28l-1 3" />
      </g>
    {:else if glyph === 'snow'}
      <g fill="currentColor">
        <circle cx="14" cy="30" r="1.6" />
        <circle cx="20" cy="30" r="1.6" />
        <circle cx="26" cy="30" r="1.6" />
      </g>
    {:else if glyph === 'fog'}
      <g stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-opacity="0.7">
        <path d="M11 29h18M14 32h12" />
      </g>
    {:else if glyph === 'thunder'}
      <path d="M21 26l-6 6h4l-2 5 7-7h-4l2-4z" fill="currentColor" />
    {/if}
  {/if}
</svg>
