<script lang="ts">
  import { recordOf } from './lib'
  import type { BusLike } from './lib'

  // The top bar: workspaces on the left, the configured children (volume,
  // battery, clock, …) on the right, and a reserved gap between them — the
  // notch is a sibling top-level view floating over the bar's centre, so the
  // bar must keep that span clear.

  interface WorkspaceEntry {
    id: number
    name: string
    occupied: boolean
  }

  let {
    bus,
    childrenHost,
    centerGap = 0,
  }: { bus: BusLike; childrenHost: HTMLElement; centerGap?: number } = $props()

  let workspaceList: WorkspaceEntry[] = $state([])
  let activeWorkspaceId = $state(-1)
  let urgentWorkspaceIds: Set<number> = $state(new Set())
  let workspaceByWindowAddress = new Map<string, number>()

  $effect(() => {
    const unsubscribers = [
      bus.subscribe('hypr.workspaces', (message) => {
        workspaceList = workspacesOf(message.data)
      }),
      bus.subscribe('hypr.activeworkspace', (message) => {
        activeWorkspaceId = activeIdOf(message.data)
        clearUrgent(activeWorkspaceId)
      }),
      bus.subscribe('hypr.windows', (message) => {
        workspaceByWindowAddress = windowWorkspacesOf(message.data)
      }),
      bus.subscribe('hypr.event', (message) => {
        markUrgentFromEvent(message.data)
      }),
    ]
    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe()
      }
    }
  })

  // Hyprland lists special workspaces with negative ids; the bar shows only
  // the regular ones, in id order.
  function workspacesOf(data: unknown): WorkspaceEntry[] {
    if (!Array.isArray(data)) {
      return []
    }
    const entries: WorkspaceEntry[] = []
    for (const raw of data) {
      const entry = workspaceEntryOf(recordOf(raw))
      if (entry !== null) {
        entries.push(entry)
      }
    }
    return entries.sort((left, right) => left.id - right.id)
  }

  function workspaceEntryOf(record: Record<string, unknown>): WorkspaceEntry | null {
    if (typeof record.id !== 'number' || record.id <= 0) {
      return null
    }
    return {
      id: record.id,
      name: workspaceNameOf(record),
      occupied: windowCountOf(record) > 0,
    }
  }

  function workspaceNameOf(record: Record<string, unknown>): string {
    if (typeof record.name === 'string' && record.name !== '') {
      return record.name
    }
    return String(record.id)
  }

  function windowCountOf(record: Record<string, unknown>): number {
    if (typeof record.windows === 'number') {
      return record.windows
    }
    return 0
  }

  function activeIdOf(data: unknown): number {
    const id = recordOf(data).id
    if (typeof id === 'number') {
      return id
    }
    return -1
  }

  // Urgency arrives out of band as "urgent>>ADDRESS"; the address is resolved
  // against the window snapshot to colour the workspace that owns it.
  function markUrgentFromEvent(data: unknown): void {
    const record = recordOf(data)
    if (record.event !== 'urgent' || typeof record.data !== 'string') {
      return
    }
    const workspaceId = workspaceByWindowAddress.get(bareAddress(record.data))
    if (workspaceId === undefined || workspaceId === activeWorkspaceId) {
      return
    }
    urgentWorkspaceIds = new Set(urgentWorkspaceIds).add(workspaceId)
  }

  function clearUrgent(workspaceId: number): void {
    if (!urgentWorkspaceIds.has(workspaceId)) {
      return
    }
    const remaining = new Set(urgentWorkspaceIds)
    remaining.delete(workspaceId)
    urgentWorkspaceIds = remaining
  }

  function windowWorkspacesOf(data: unknown): Map<string, number> {
    const byAddress = new Map<string, number>()
    if (!Array.isArray(data)) {
      return byAddress
    }
    for (const raw of data) {
      addWindowWorkspace(byAddress, recordOf(raw))
    }
    return byAddress
  }

  function addWindowWorkspace(
    byAddress: Map<string, number>,
    record: Record<string, unknown>,
  ): void {
    const workspaceId = recordOf(record.workspace).id
    if (typeof record.address !== 'string' || typeof workspaceId !== 'number') {
      return
    }
    byAddress.set(bareAddress(record.address), workspaceId)
  }

  // Window queries print addresses as "0x55…", the event stream without the
  // prefix; both sides are compared bare.
  function bareAddress(value: string): string {
    if (value.startsWith('0x')) {
      return value.slice(2)
    }
    return value
  }

  function switchWorkspace(id: number): void {
    void bus.call('hypr:dispatch', { dispatcher: 'workspace', arg: String(id) })
  }

  const WORKSPACE_BASE =
    'h-6 min-w-6 cursor-pointer rounded-lg px-2 text-center text-[11px] leading-6 ' +
    'transition-colors duration-150 '

  function workspaceClass(workspace: WorkspaceEntry): string {
    if (urgentWorkspaceIds.has(workspace.id)) {
      return WORKSPACE_BASE + 'bg-warning/20 font-semibold text-warning'
    }
    if (workspace.id === activeWorkspaceId) {
      return WORKSPACE_BASE + 'bg-base-content/15 font-semibold text-base-content'
    }
    if (workspace.occupied) {
      return WORKSPACE_BASE + 'text-base-content/70 hover:bg-base-content/10'
    }
    return WORKSPACE_BASE + 'text-base-content/25 hover:bg-base-content/10'
  }

  function adopt(node: HTMLElement, hosted: HTMLElement): void {
    node.appendChild(hosted)
  }
</script>

<div
  class="grid h-full grid-cols-[1fr_auto_1fr] items-center bg-base-200/40 px-3 text-[13px]
    font-medium text-base-content select-none"
>
  <div class="flex min-w-0 items-center gap-1">
    {#each workspaceList as workspace (workspace.id)}
      <button
        class={workspaceClass(workspace)}
        onclick={() => switchWorkspace(workspace.id)}
        aria-current={workspace.id === activeWorkspaceId}
      >
        {workspace.name}
      </button>
    {/each}
  </div>
  <div style:width="{centerGap}px"></div>
  <div class="flex justify-end" use:adopt={childrenHost}></div>
</div>
