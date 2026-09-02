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
