// Launcher-side entry point into the backend's shared action registry — the
// same named actions the AI calls as tools. A provider invokes a command
// instead of hand-rolling a bespoke message type, so the launcher and the AI
// stay in lockstep on one definition per feature.

import { send } from "./connection.svelte.js";

export function invokeCommand(name: string, args: Record<string, unknown> = {}) {
  send({ type: "command:invoke", name, data: args });
}
