// The shape checks every view and backend repeats: an unknown that has to be
// read as a JSON value. The bus never parses payloads, so this is where a
// malformed one turns into an empty record instead of a crash.
export function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  return value as Record<string, unknown>
}

// A retained topic that carries a list of records — a network scan, a device
// list — read as one, with the non-objects dropped rather than the whole
// payload.
export function arrayOf(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map(recordOf)
}

export function stringOf(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  return ''
}

export function numberOf(value: unknown, fallback: number): number {
  if (typeof value === 'number') {
    return value
  }
  return fallback
}

export function stringListOf(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((entry) => typeof entry === 'string')
}
