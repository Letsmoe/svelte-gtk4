// Verbatim port of the parsing helpers in Topbar.svelte. Nothing here touches
// the DOM or GTK — it moved across unchanged, which is the point of the spike.

export interface WorkspaceEntry {
  id: number
  name: string
  occupied: boolean
}

export function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  return value as Record<string, unknown>
}

// Hyprland lists special workspaces with negative ids; the bar shows only the
// regular ones, in id order.
export function workspacesOf(data: unknown): WorkspaceEntry[] {
  if (!Array.isArray(data)) {
    return []
  }
  const entries: WorkspaceEntry[] = []
  for (const raw of data) {
    pushWorkspace(entries, recordOf(raw))
  }
  return entries.sort((left, right) => left.id - right.id)
}

function pushWorkspace(entries: WorkspaceEntry[], record: Record<string, unknown>): void {
  if (typeof record.id !== 'number' || record.id <= 0) {
    return
  }
  entries.push({
    id: record.id,
    name: workspaceNameOf(record),
    occupied: windowCountOf(record) > 0,
  })
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

export function activeIdOf(data: unknown): number {
  const id = recordOf(data).id
  if (typeof id === 'number') {
    return id
  }
  return -1
}

export function windowWorkspacesOf(data: unknown): Map<string, number> {
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
export function bareAddress(value: string): string {
  if (value.startsWith('0x')) {
    return value.slice(2)
  }
  return value
}

// Urgency arrives out of band as "urgent>>ADDRESS".
export function urgentAddressOf(data: unknown): string | null {
  const record = recordOf(data)
  if (record.event !== 'urgent' || typeof record.data !== 'string') {
    return null
  }
  return bareAddress(record.data)
}
