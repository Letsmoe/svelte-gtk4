import type { Context } from '@neoworks/extension-system'

// startPolling refreshes once now and then on an interval, as an effect, so
// the timer dies with the plugin.
export function startPolling(
  context: Context,
  intervalMs: number,
  refresh: () => Promise<void>,
): void {
  context.effect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), intervalMs)
    return () => {
      clearInterval(timer)
    }
  })
}
