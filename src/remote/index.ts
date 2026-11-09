// The host side of remote clients, as `@neoworks/svelte-gtk4/host`.

export { DEFAULT_LIMITS, defaultPolicy, REFUSED, Rewrite } from "./policy";
export type { Limits, Policy, PolicyOptions } from "./policy";
export { ProtocolError, RemoteTree } from "./host";
export { EMBED_TAG } from "./embed";
export type { EmbeddedView, Embedder } from "./embed";
export { RemoteClient } from "./supervisor";
export type { ClientStatus, RemoteClientOptions } from "./supervisor";
