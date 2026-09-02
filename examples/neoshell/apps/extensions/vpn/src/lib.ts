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

// VpnState is one vpn.state message, already checked.
export interface VpnState {
  available: boolean
  connected: boolean
  name: string
  type: string
  device: string
  ipv4: string
}

export function emptyVpnState(): VpnState {
  return {
    available: false,
    connected: false,
    name: '',
    type: '',
    device: '',
    ipv4: '',
  }
}

export function vpnStateOf(data: unknown): VpnState {
  const record = recordOf(data)
  return {
    available: record.available === true,
    connected: record.connected === true,
    name: stringOf(record.name),
    type: stringOf(record.type),
    device: stringOf(record.device),
    ipv4: stringOf(record.ipv4),
  }
}

export function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  return value as Record<string, unknown>
}

export function stringOf(value: unknown): string {
  if (typeof value === 'string') {
    return value
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
