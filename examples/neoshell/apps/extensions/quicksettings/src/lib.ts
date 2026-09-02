import type { Context } from '@neoworks/extension-system'

// BusLike mirrors the surface runtime's BusClient; views receive it through
// the 'bus' service. Every extension carries its own copy: an extension is a
// self-contained directory, and a views bundle that imports across extensions
// could not be dropped in on its own.

export interface BusMessage {
  type: string
  data: unknown
}

export interface BusLike {
  publish(type: string, data: unknown): void
  subscribe(pattern: string, handler: (message: BusMessage) => void): () => void
  call(type: string, data: unknown, timeoutMs?: number): Promise<unknown>
}

export function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  return value as Record<string, unknown>
}

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

// errorOf turns a command reply into a message for the panel: backends answer
// {ok:true} or {error}, and a timed-out call rejects instead.
export function errorOf(reply: unknown): string {
  const error = recordOf(reply).error
  if (typeof error === 'string') {
    return error
  }
  return ''
}

// requireService reads a service the view plugin listed in its inject, where
// the kernel guarantees presence — it throws instead of returning undefined so
// callers skip the null check.
export function requireService<Value>(context: Context, name: string): Value {
  const value = context.get(name) as Value | undefined
  if (value === undefined) {
    throw new Error(`views: service "${name}" is not available`)
  }
  return value
}
