import { untrack } from 'svelte'
import type { Context } from '@neoworks/extension-system'

// Shared bus glue for bundled extensions. Extensions depend on this structural
// shape of the host's bus service, never on the host package itself.

export interface BusMessage {
  type: string
  data: unknown
  replyTo?: string
}

export interface BusService {
  publish(type: string, data: unknown): void
  retain(type: string, data: unknown): () => void
  subscribe(pattern: string, handler: (message: BusMessage) => void): () => void
  call(type: string, data: unknown, timeoutMs?: number): Promise<unknown>
}

// subscribeTo is how a view subscribes from inside an $effect. A retained topic
// replays synchronously inside subscribe(), so the handler runs in that
// effect's tracking scope: everything it reads becomes a dependency of the
// subscription, and everything it writes re-runs the effect — which
// resubscribes, replays, and writes again. untrack keeps the subscription an
// effect without making its payload one.
export function subscribeTo(
  bus: BusService,
  pattern: string,
  handler: (message: BusMessage) => void,
): () => void {
  return bus.subscribe(pattern, (message) => untrack(() => handler(message)))
}

// errorOf turns a command reply into a message for the caller: backends answer
// {ok:true} or {error}, and a view that shows a failure needs the one string.
export function errorOf(reply: unknown): string {
  if (typeof reply !== 'object' || reply === null) {
    return ''
  }
  const error = (reply as Record<string, unknown>).error
  if (typeof error === 'string') {
    return error
  }
  return ''
}

// registerFunction exposes one named function as bus request/reply. The
// subscription is an effect, so the function is withdrawn with the plugin. A
// throwing handler replies {error} instead of leaving the caller hanging.
export function registerFunction(
  context: Context,
  bus: BusService,
  type: string,
  handler: (data: unknown) => unknown,
): void {
  context.effect(() =>
    bus.subscribe(type, (message) => {
      void handleCall(bus, message, handler)
    }),
  )
}

async function handleCall(
  bus: BusService,
  message: BusMessage,
  handler: (data: unknown) => unknown,
): Promise<void> {
  let result: unknown
  try {
    result = await handler(message.data)
  } catch (error) {
    result = { error: String(error) }
  }
  if (message.replyTo === undefined) {
    return
  }
  bus.publish(message.replyTo, result)
}

// RetainedTopics tracks one withdraw function per topic so a republish always
// replaces cleanly and disposal withdraws everything at once.
export class RetainedTopics {
  private readonly withdrawals = new Map<string, () => void>()
  private readonly bus: BusService

  constructor(bus: BusService) {
    this.bus = bus
  }

  set(topic: string, data: unknown): void {
    const previous = this.withdrawals.get(topic)
    if (previous !== undefined) {
      previous()
    }
    this.withdrawals.set(topic, this.bus.retain(topic, data))
  }

  withdrawAll(): void {
    for (const withdraw of this.withdrawals.values()) {
      withdraw()
    }
    this.withdrawals.clear()
  }
}
