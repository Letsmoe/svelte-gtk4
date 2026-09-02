import type { Context } from '@neoworks/extension-system'

// requireService reads a service the extension listed in its manifest inject,
// where the kernel guarantees presence — it throws instead of returning
// undefined so callers skip the null check. Reading by name is what lets an
// extension depend on the structural shape of a host service without importing
// the host's types.
export function requireService<Value>(context: Context, name: string): Value {
  const value = context.get(name) as Value | undefined
  if (value === undefined) {
    throw new Error(`extension: service "${name}" is not available`)
  }
  return value
}
