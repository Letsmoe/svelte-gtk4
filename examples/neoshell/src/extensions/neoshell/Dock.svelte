<script lang="ts">
  import { subscribeTo } from '../../lib/bus'
  import type { ViewProps } from '../../host/plugins/views'
  import { recordOf } from '../../lib/record'

  // The dock: a centred floating panel of launchers, hidden below the screen
  // edge until the pointer enters the hot strip along it.
  //
  // The webview build had the host collapse the whole surface to that strip and
  // report it as the input region. A layer-shell window keeps its full height
  // here, so the strip and the revealed panel each mark themselves as the input
  // region instead — everything else on the dock's window stays click-through,
  // and the reveal is one piece of state rather than two that could disagree.
  //
  // Entries are the pinned apps followed by every app with an open window
  // (hypr.windows) that is not already pinned. Pins come from the config key
  // dock.pinned (ids or names matched against the desktop-entry catalog), or
  // from dock.apps, which carries whole records. Clicking a running app focuses
  // its window instead of launching a second instance.

  interface DockApp {
    id: string
    name: string
    exec: string
    icon: string
    wmClass: string
  }

  const LAUNCH_TIMEOUT_MS = 15000
  const ICON_PIXELS = 44
  const HOT_STRIP_PIXELS = 4
  // Long enough to cross onto another output and back without the dock going.
  const COLLAPSE_DELAY_MS = 400

  // Magnification: the hovered icon grows and its neighbours grow less and
  // slide outwards, so the row spreads around the cursor. GTK CSS has no
  // sibling combinators, so what was `.app:hover + .app` is a distance from the
  // hovered index and an inline transform.
  const MAGNIFY = [
    { scale: 1.45, shift: 0 },
    { scale: 1.2, shift: 6.4 },
    { scale: 1.06, shift: 8 },
  ]

  let { bus }: ViewProps = $props()

  let catalog = $state<DockApp[]>([])
  let openClasses = $state<string[]>([])
  let pinnedNames = $state<string[]>([])
  let configuredApps = $state<DockApp[]>([])
  let revealed = $state(false)
  let hoveredIndex = $state(-1)
  let launching = $state<ReadonlySet<string>>(new Set())

  // Either half of the hot area keeps the dock open, so travelling from the
  // strip into the panel never passes through a moment where neither is under
  // the pointer. Leaving is delayed on top of that: the pointer crossing onto
  // another output leaves the surface outright, and a dock that vanished the
  // instant it did would be unusable on a multi-monitor desk.
  let overStrip = false
  let overPanel = false
  let collapseTimer: number | null = null

  const pinned = $derived(resolvePinned(catalog, pinnedNames, configuredApps))
  const entries = $derived(dockEntries(catalog, pinned, openClasses))
  const openKeys = $derived(new Set(openClasses.map((wmClass) => wmClass.toLowerCase())))

  $effect(() =>
    subscribeTo(bus, 'hypr.windows', (message) => {
      openClasses = openClassesOf(message.data)
      stopLandedLaunches()
    }),
  )

  $effect(() =>
    subscribeTo(bus, 'config', (message) => {
      pinnedNames = pinnedNamesOf(message.data)
      configuredApps = configuredAppsOf(message.data)
    }),
  )

  $effect(() => {
    void loadCatalog()
  })

  // The apps extension may not have mounted yet, in which case the call times
  // out — the dock stays empty rather than the rejection escaping into a
  // warning with no context.
  async function loadCatalog(): Promise<void> {
    let reply: unknown
    try {
      reply = await bus.call('apps:list', {})
    } catch (error) {
      console.error('dock: cannot read the application catalog:', error)
      return
    }
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

  function iconClass(id: string): string {
    if (launching.has(id)) {
      return 'dock-icon hopping'
    }
    return 'dock-icon'
  }

  // The transform is on the icon rather than the tile, so the row's hit boxes
  // stay put while the icons swell — a magnified tile that moved under the
  // cursor would flip the hover to its neighbour and oscillate.
  function magnifyCss(index: number): string {
    const distance = Math.abs(index - hoveredIndex)
    if (hoveredIndex < 0 || distance >= MAGNIFY.length) {
      return ''
    }
    const step = MAGNIFY[distance]
    const direction = Math.sign(index - hoveredIndex)
    return `transform: translateX(${direction * step.shift}px) scale(${step.scale});`
  }

  function hover(index: number): void {
    hoveredIndex = index
  }

  function unhover(index: number): void {
    if (hoveredIndex === index) {
      hoveredIndex = -1
    }
  }

  function enter(part: 'strip' | 'panel'): void {
    setOver(part, true)
    cancelCollapse()
    revealed = true
  }

  function leave(part: 'strip' | 'panel'): void {
    setOver(part, false)
    if (part === 'panel') {
      hoveredIndex = -1
    }
    scheduleCollapse()
  }

  function setOver(part: 'strip' | 'panel', value: boolean): void {
    if (part === 'strip') {
      overStrip = value
      return
    }
    overPanel = value
  }

  function scheduleCollapse(): void {
    cancelCollapse()
    collapseTimer = setTimeout(() => {
      collapseTimer = null
      if (overStrip || overPanel) {
        return
      }
      revealed = false
      hoveredIndex = -1
    }, COLLAPSE_DELAY_MS)
  }

  function cancelCollapse(): void {
    if (collapseTimer === null) {
      return
    }
    clearTimeout(collapseTimer)
    collapseTimer = null
  }

  $effect(() => cancelCollapse)
</script>

<!-- The strip and the panel each watch the pointer for themselves rather than
     sharing one controller on an ancestor: a motion controller on a container
     reports a leave when the pointer crosses into a child, which would collapse
     the dock the instant it opened. -->
<gtkbox class="dock-root" orientation="vertical" hexpand vexpand>
  <gtkbox vexpand></gtkbox>

  <gtkrevealer reveal={revealed} transition="slide-up" duration={200} halign="center">
    <!-- The bottom padding belongs to the marked box, so its rect reaches the
         screen edge and joins the hot strip. A gap between the two would leave
         the pointer over neither on the way up, and collapse the dock. -->
    <gtkpressable
      class="dock-panel"
      orientation="vertical"
      input={revealed}
      onhoverstart={() => enter('panel')}
      onhoverend={() => leave('panel')}
    >
      <gtkbox class="dock" orientation="horizontal" spacing={4}>
        {#each entries as app, index (app.id)}
          <gtkpressable
            class="dock-app"
            orientation="vertical"
            width={52}
            tooltip={app.name}
            onhoverstart={() => hover(index)}
            onhoverend={() => unhover(index)}
            onpress={() => void activate(app)}
          >
            <gtkicon
              class={iconClass(app.id)}
              icon={app.icon}
              size={ICON_PIXELS}
              halign="center"
              css={magnifyCss(index)}
            ></gtkicon>
            <gtkbox
              class="dock-running"
              width={4}
              height={4}
              halign="center"
              visible={isOpen(app)}
            ></gtkbox>
          </gtkpressable>
        {/each}
      </gtkbox>
    </gtkpressable>
  </gtkrevealer>

  <!-- The hot strip is always in the input region: it is the only part of a
       hidden dock the compositor lets the pointer reach. -->
  <gtkpressable
    class="dock-hot-strip"
    height={HOT_STRIP_PIXELS}
    hexpand
    input
    onhoverstart={() => enter('strip')}
    onhoverend={() => leave('strip')}
  ></gtkpressable>
</gtkbox>
