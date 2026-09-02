<script lang="ts">
  import { recordOf } from './lib'
  import type { BusLike } from './lib'

  // The dock: a centered floating panel of launchers, hidden below the screen
  // edge until the pointer enters the hot strip along it. The host owns that
  // reveal — it collapses the surface node to the strip, which is also what it
  // reports as the input region — so the panel slides with the node's height
  // rather than tracking the pointer itself. Two independent triggers could
  // disagree, leaving a collapsed dock that still swallows clicks.
  //
  // Entries are the pinned apps followed by every app with an open window
  // (hypr.windows) that is not already pinned. Pins come from the config key
  // dock.pinned (ids or names matched against the desktop-entry catalog), or
  // from dock.apps, which carries whole records. Clicking a running app
  // focuses its window instead of launching a second instance.

  interface DockApp {
    id: string
    name: string
    exec: string
    icon: string
    wmClass: string
  }

  const LAUNCH_TIMEOUT_MS = 15000
  // Above the hot strip's few pixels, below the panel's full height.
  const REVEAL_THRESHOLD_PX = 16

  let { bus }: { bus: BusLike } = $props()

  let catalog: DockApp[] = $state([])
  let openClasses: string[] = $state([])
  let pinnedNames: string[] = $state([])
  let configuredApps: DockApp[] = $state([])
  let revealed = $state(false)
  let brokenIcons: Set<string> = $state(new Set())
  let launching: Set<string> = $state(new Set())
  let dockRoot: HTMLElement

  const pinned = $derived(resolvePinned(catalog, pinnedNames, configuredApps))
  const entries = $derived(dockEntries(catalog, pinned, openClasses))
  const openKeys = $derived(new Set(openClasses.map((wmClass) => wmClass.toLowerCase())))

  $effect(() => {
    const unsubscribeWindows = bus.subscribe('hypr.windows', (message) => {
      openClasses = openClassesOf(message.data)
      stopLandedLaunches()
    })
    const unsubscribeConfig = bus.subscribe('config', (message) => {
      pinnedNames = pinnedNamesOf(message.data)
      configuredApps = configuredAppsOf(message.data)
    })
    void loadCatalog()
    return () => {
      unsubscribeWindows()
      unsubscribeConfig()
    }
  })

  $effect(() => {
    const observer = new ResizeObserver(() => {
      revealed = dockRoot.clientHeight > REVEAL_THRESHOLD_PX
    })
    observer.observe(dockRoot)
    return () => observer.disconnect()
  })

  async function loadCatalog(): Promise<void> {
    const reply = await bus.call('apps:list', {})
    if (!Array.isArray(reply)) {
      return
    }
    catalog = reply.map(dockAppOf)
  }

  function dockAppOf(raw: unknown): DockApp {
    const record = recordOf(raw)
    const app: DockApp = { id: '', name: '', exec: '', icon: '', wmClass: '' }
    if (typeof record.id === 'string') {
      app.id = record.id
    }
    if (typeof record.name === 'string') {
      app.name = record.name
    }
    if (app.name === '' && typeof record.label === 'string') {
      app.name = record.label
    }
    if (typeof record.exec === 'string') {
      app.exec = record.exec
    }
    if (typeof record.icon === 'string') {
      app.icon = record.icon
    }
    if (typeof record.wmClass === 'string') {
      app.wmClass = record.wmClass
    }
    return app
  }

  // dockEntries keeps the pinned order, then appends the open windows' apps so
  // the dock always shows what is actually running.
  function dockEntries(available: DockApp[], selected: DockApp[], open: string[]): DockApp[] {
    const shown = [...selected]
    const taken = new Set(shown.map((app) => app.id.toLowerCase()))
    for (const wmClass of open) {
      const app = entryForClass(available, wmClass)
      if (!taken.has(app.id.toLowerCase())) {
        taken.add(app.id.toLowerCase())
        shown.push(app)
      }
    }
    return shown
  }

  // resolvePinned prefers dock.pinned (names resolved against the catalog) and
  // falls back to dock.apps, whose records already carry exec and icon.
  function resolvePinned(
    available: DockApp[],
    wanted: string[],
    configured: DockApp[],
  ): DockApp[] {
    if (wanted.length === 0) {
      return configured
    }
    const selected: DockApp[] = []
    for (const entry of wanted) {
      const app = findApp(available, entry)
      if (app !== null) {
        selected.push(app)
      }
    }
    return selected
  }

  function findApp(available: DockApp[], wanted: string): DockApp | null {
    const needle = wanted.toLowerCase()
    for (const app of available) {
      if (app.id.toLowerCase() === needle || app.name.toLowerCase() === needle) {
        return app
      }
    }
    return null
  }

  // entryForClass resolves a window class against the desktop-entry catalog;
  // windows whose class matches nothing still get a tile, named after the class.
  function entryForClass(available: DockApp[], wmClass: string): DockApp {
    const needle = wmClass.toLowerCase()
    for (const app of available) {
      if (matchesClass(app, needle)) {
        return app
      }
    }
    return { id: wmClass, name: wmClass, exec: '', icon: wmClass, wmClass }
  }

  function matchesClass(app: DockApp, needle: string): boolean {
    if (app.wmClass !== '') {
      return app.wmClass.toLowerCase() === needle
    }
    return app.id.toLowerCase() === needle || app.name.toLowerCase() === needle
  }

  function openClassesOf(data: unknown): string[] {
    const classes = new Set<string>()
    if (!Array.isArray(data)) {
      return []
    }
    for (const raw of data) {
      const value = recordOf(raw).class
      if (typeof value === 'string' && value !== '') {
        classes.add(value)
      }
    }
    return [...classes].sort((left, right) => left.localeCompare(right))
  }

  function pinnedNamesOf(snapshot: unknown): string[] {
    const dockConfig = recordOf(recordOf(snapshot).dock)
    if (!Array.isArray(dockConfig.pinned)) {
      return []
    }
    return dockConfig.pinned.filter((value) => typeof value === 'string')
  }

  function configuredAppsOf(snapshot: unknown): DockApp[] {
    const dockConfig = recordOf(recordOf(snapshot).dock)
    if (!Array.isArray(dockConfig.apps)) {
      return []
    }
    return dockConfig.apps.map(dockAppOf).filter((app) => app.id !== '')
  }

  function isOpen(app: DockApp): boolean {
    if (app.wmClass !== '') {
      return openKeys.has(app.wmClass.toLowerCase())
    }
    return openKeys.has(app.id.toLowerCase())
  }

  async function activate(app: DockApp): Promise<void> {
    if (isOpen(app)) {
      void bus.call('hypr:dispatch', { dispatcher: 'focuswindow', arg: `class:${focusClass(app)}` })
      return
    }
    startLaunch(app.id)
    const reply = recordOf(await bus.call('apps:launch', { command: app.exec }))
    if (reply.error === undefined) {
      return
    }
    console.error(`dock: launching ${app.name} failed:`, reply.error)
    stopLaunch(app.id)
  }

  // The icon hops until the app's window turns up on hypr.windows; the timeout
  // ends it for apps that never map one (or that died on startup).
  function startLaunch(id: string): void {
    launching = new Set(launching).add(id)
    setTimeout(() => stopLaunch(id), LAUNCH_TIMEOUT_MS)
  }

  function stopLaunch(id: string): void {
    if (!launching.has(id)) {
      return
    }
    const next = new Set(launching)
    next.delete(id)
    launching = next
  }

  function stopLandedLaunches(): void {
    for (const app of entries) {
      if (launching.has(app.id) && isOpen(app)) {
        stopLaunch(app.id)
      }
    }
  }

  function focusClass(app: DockApp): string {
    if (app.wmClass !== '') {
      return app.wmClass
    }
    return app.id
  }

  function iconUrl(app: DockApp): string {
    return `/appicon/${encodeURIComponent(app.icon)}?size=96`
  }

  function markIconBroken(app: DockApp): void {
    brokenIcons = new Set(brokenIcons).add(app.id)
  }

  function initialOf(app: DockApp): string {
    return app.name.slice(0, 1).toUpperCase()
  }
</script>

<div class="relative h-full" bind:this={dockRoot}>
  <div class="absolute inset-x-0 bottom-0 h-1" data-input-region aria-hidden="true"></div>
  <div
    class="absolute inset-x-0 bottom-0 flex justify-center
      transition-transform duration-200 ease-out"
    class:translate-y-full={!revealed}
    role="toolbar"
    tabindex="-1"
    aria-label="Dock"
    aria-orientation="horizontal"
  >
    <!-- The padding belongs to the marked box so its rect reaches the screen
         edge and joins the hot strip; a gap between them would collapse the
         dock as the pointer travelled up into it. -->
    <div class="pb-2" data-input-region>
      <div
        class="flex items-end gap-1 rounded-2xl border border-base-content/10 bg-base-200/40 px-2 py-1.5"
      >
      {#each entries as app (app.id)}
        <button
          class="app group relative flex w-13 cursor-pointer flex-col items-center pb-1.5"
          onclick={() => activate(app)}
        >
          <span
            class="pointer-events-none absolute bottom-full mb-6 origin-bottom scale-90 rounded-md
              border border-base-content/10 bg-base-300/90 px-2 py-0.5 text-xs whitespace-nowrap
              opacity-0 transition duration-150 group-hover:scale-100 group-hover:opacity-100"
          >
            {app.name}
          </span>
          <span class="zoom">
            <span class="hop" class:hopping={launching.has(app.id)}>
              {#if brokenIcons.has(app.id)}
                <span
                  class="flex h-11 w-11 items-center justify-center rounded-xl bg-base-content/10
                    text-lg font-semibold"
                >
                  {initialOf(app)}
                </span>
              {:else}
                <img
                  class="h-11 w-11 object-contain drop-shadow-md"
                  src={iconUrl(app)}
                  alt={app.name}
                  onerror={() => markIconBroken(app)}
                />
              {/if}
            </span>
          </span>
          {#if isOpen(app)}
            <span class="absolute bottom-0 h-1 w-1 rounded-full bg-base-content/80"></span>
          {/if}
        </button>
      {/each}
      </div>
    </div>
  </div>
</div>

<style>
  /* Magnification: the hovered icon grows and its neighbours grow less and
     slide outwards, so the row spreads around the cursor. Sizing lives on an
     inner element, keeping the button box — and the label — unscaled. */
  .zoom,
  .hop {
    display: block;
    transform-origin: 50% 100%;
  }

  .zoom {
    transition: transform 160ms cubic-bezier(0.2, 0.7, 0.3, 1);
  }

  .app:hover .zoom {
    transform: scale(1.45);
  }

  .app:hover + .app .zoom {
    transform: translateX(0.4rem) scale(1.2);
  }

  .app:has(+ .app:hover) .zoom {
    transform: translateX(-0.4rem) scale(1.2);
  }

  .app:hover + .app + .app .zoom {
    transform: translateX(0.5rem) scale(1.06);
  }

  .app:has(+ .app + .app:hover) .zoom {
    transform: translateX(-0.5rem) scale(1.06);
  }

  /* Launch feedback: the icon presses into the dock, is flung up with the
     stretch of leaving the floor, hangs at the apex, then lands squashed.
     Per-segment easing carries the arc — deceleration up, acceleration down. */
  .hopping {
    animation: hop 1.15s infinite;
  }

  @keyframes hop {
    0% {
      transform: translateY(0) scale(1, 1);
      animation-timing-function: cubic-bezier(0.4, 0, 0.7, 0.4);
    }
    9% {
      transform: translateY(0) scale(1.12, 0.8);
      animation-timing-function: cubic-bezier(0.3, 0.5, 0.6, 1);
    }
    19% {
      transform: translateY(-18%) scale(0.94, 1.1);
      animation-timing-function: cubic-bezier(0.12, 0.6, 0.35, 1);
    }
    50% {
      transform: translateY(-100%) scale(1, 1);
      animation-timing-function: cubic-bezier(0.6, 0, 0.85, 0.4);
    }
    76% {
      transform: translateY(0) scale(1.1, 0.86);
      animation-timing-function: cubic-bezier(0.2, 0.8, 0.4, 1);
    }
    86% {
      transform: translateY(0) scale(0.98, 1.03);
    }
    94%,
    100% {
      transform: translateY(0) scale(1, 1);
    }
  }
</style>
