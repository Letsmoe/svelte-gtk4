<script lang="ts">
  import { subscribeTo } from '../../lib/bus'
  import type { ViewProps } from '../../host/plugins/views'
  import { recordOf } from '../../lib/record'
  import {
    activeIdOf,
    urgentAddressOf,
    windowWorkspacesOf,
    workspacesOf,
  } from './hypr'
  import type { WorkspaceEntry } from './hypr'

  // The top bar: workspaces on the left, the configured children (battery,
  // clock, …) on the right, and a reserved gap between them — the notch is a
  // sibling top-level view floating over the bar's centre, so the bar must keep
  // that span clear.

  let { bus, args, children }: ViewProps = $props()

  const centerGap = $derived(centerGapOf(args))

  let workspaceList = $state<WorkspaceEntry[]>([])
  let activeWorkspaceId = $state(-1)
  let urgentWorkspaceIds = $state<ReadonlySet<number>>(new Set())
  let workspaceByWindowAddress = new Map<string, number>()

  // The subscriptions are set up once: their handlers run long after the effect
  // has finished, so nothing they read becomes a dependency.
  $effect(() =>
    subscribeTo(bus, 'hypr.workspaces', (message) => {
      workspaceList = workspacesOf(message.data)
    }),
  )

  $effect(() =>
    subscribeTo(bus, 'hypr.activeworkspace', (message) => {
      activeWorkspaceId = activeIdOf(message.data)
      urgentWorkspaceIds = without(urgentWorkspaceIds, activeWorkspaceId)
    }),
  )

  $effect(() =>
    subscribeTo(bus, 'hypr.windows', (message) => {
      workspaceByWindowAddress = windowWorkspacesOf(message.data)
    }),
  )

  $effect(() =>
    subscribeTo(bus, 'hypr.event', (message) => {
      markUrgent(urgentAddressOf(message.data))
    }),
  )

  // Urgency arrives out of band as "urgent>>ADDRESS"; the address is resolved
  // against the window snapshot to colour the workspace that owns it.
  function markUrgent(address: string | null): void {
    if (address === null) {
      return
    }
    const workspaceId = workspaceByWindowAddress.get(address)
    if (workspaceId === undefined || workspaceId === activeWorkspaceId) {
      return
    }
    urgentWorkspaceIds = new Set(urgentWorkspaceIds).add(workspaceId)
  }

  function without(set: ReadonlySet<number>, id: number): ReadonlySet<number> {
    if (!set.has(id)) {
      return set
    }
    const remaining = new Set(set)
    remaining.delete(id)
    return remaining
  }

  function switchWorkspace(workspace: WorkspaceEntry): void {
    void bus.call('hypr:dispatch', { dispatcher: 'workspace', arg: String(workspace.id) })
  }

  function stateOf(workspace: WorkspaceEntry): string {
    if (urgentWorkspaceIds.has(workspace.id)) {
      return 'urgent'
    }
    if (workspace.id === activeWorkspaceId) {
      return 'active'
    }
    if (workspace.occupied) {
      return 'occupied'
    }
    return 'empty'
  }

  // centerGap is the span the bar keeps clear for the notch, which floats over
  // the bar's centre as its own layer-shell window.
  function centerGapOf(value: unknown): number {
    const gap = recordOf(value).centerGap
    if (typeof gap !== 'number') {
      return 0
    }
    return gap
  }
</script>

<gtkcenterbox class="topbar" orientation="horizontal" hexpand vexpand input>
  <gtkbox
    place="start"
    orientation="horizontal"
    spacing={4}
    valign="center"
    halign="start"
  >
    {#each workspaceList as workspace (workspace.id)}
      <gtkbutton
        class="workspace {stateOf(workspace)}"
        frame={false}
        onclicked={() => switchWorkspace(workspace)}
      >
        {workspace.name}
      </gtkbutton>
    {/each}
  </gtkbox>

  <!-- The notch gap: a fixed-width centre slot the CenterBox keeps centred. -->
  <gtkbox place="center" width={centerGap}></gtkbox>

  <gtkbox
    place="end"
    orientation="horizontal"
    spacing={16}
    valign="center"
    halign="end"
  >
    {@render children?.()}
  </gtkbox>
</gtkcenterbox>
