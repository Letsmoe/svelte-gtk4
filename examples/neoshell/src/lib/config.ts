// Reading settings out of the retained "config" snapshot. An extension's
// mount entry can carry config, but the mount list is usually implicit — every
// installed extension, no config — so the settings file is where a user
// actually configures one, and it is live-editable besides.

export function sectionOf(snapshot: unknown, key: string): Record<string, unknown> {
  const root = recordOf(snapshot)
  return recordOf(root[key])
}

export function pickString(section: Record<string, unknown>, key: string): string | undefined {
  const value = section[key]
  if (typeof value !== 'string' || value === '') {
    return undefined
  }
  return value
}

export function pickNumber(section: Record<string, unknown>, key: string): number | undefined {
  const value = section[key]
  if (typeof value !== 'number') {
    return undefined
  }
  return value
}

function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  return value as Record<string, unknown>
}
