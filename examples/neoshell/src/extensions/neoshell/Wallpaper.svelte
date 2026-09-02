<script lang="ts">
  import { subscribeTo } from '../../lib/bus'
  import type { ViewProps } from '../../host/plugins/views'
  import { recordOf } from '../../lib/record'

  // The desktop background: the configured wallpaper, a flat dark fill when
  // none is set.
  //
  // The webview build fetched this through a host route, because a page served
  // over http cannot read file://. GTK loads the file directly, so the
  // /wallpaper route and the neoshell-bg daemon it stood in front of are both
  // gone — the path from config is the path GdkPixbuf opens.

  let { bus }: ViewProps = $props()

  let wallpaperPath = $state('')

  $effect(() =>
    subscribeTo(bus, 'config', (message) => {
      wallpaperPath = pathOf(message.data)
    }),
  )

  function pathOf(snapshot: unknown): string {
    const appearance = recordOf(recordOf(snapshot).appearance)
    if (typeof appearance.wallpaper === 'string') {
      return appearance.wallpaper
    }
    return ''
  }
</script>

<gtkbox class="wallpaper" hexpand vexpand>
  {#if wallpaperPath !== ''}
    <gtkpicture file={wallpaperPath} fit="cover" hexpand vexpand></gtkpicture>
  {/if}
</gtkbox>
