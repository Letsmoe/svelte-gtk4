<script lang="ts">
  import { ICONS } from './icons.js'

  let { name, size = 20 }: { name: string; size?: number } = $props()

  const path = $derived(pathOf(name))

  function pathOf(iconName: string): string {
    const data = ICONS[iconName]
    if (data === undefined) {
      return ICONS.device
    }
    return data
  }
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.7"
  stroke-linecap="round"
  stroke-linejoin="round"
  class="shrink-0"
  aria-hidden="true"
>
  <path d={path} />
</svg>
