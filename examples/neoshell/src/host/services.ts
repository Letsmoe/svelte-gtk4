import type { Context } from '@neoworks/extension-system'

// requireService reads a service a plugin listed in its inject, where the
// kernel guarantees presence — it throws instead of returning undefined so
// callers skip the null check. Reading a service by name keeps the host's
// plugins structurally typed against their dependencies rather than bound to
// a global Context augmentation.
export function requireService<Value>(context: Context, name: string): Value {
  const value = context.get(name) as Value | undefined
  if (value === undefined) {
    throw new Error(`host: service "${name}" is not available`)
  }
  return value
}

// optionalService reads a service a plugin does not inject, so it has to cope
// with the name being absent. The lookup is non-strict: a provider that
// publishes from inside an async apply — the render host, which announces
// itself the moment its socket is up — is still loading when its dependants
// first reach for it, and a strict read would hand them undefined at exactly
// the moment they were told to look.
export function optionalService<Value>(context: Context, name: string): Value | undefined {
  return context.get(name, false) as Value | undefined
}
