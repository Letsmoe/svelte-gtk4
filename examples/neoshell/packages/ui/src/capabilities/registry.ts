import { getConfig } from "@neoshell/sdk/config.svelte.js";
import type { UICapability, NotchPresence, WidgetType } from "./types.js";

// Registered UI capabilities for this surface. Each plugin registers its own
// contributions at startup, so the registry is per-webview: the desktop plugin
// registers its widgets, the bar plugin its notch presences. This is the
// frontend half of the shared plugin model — an external plugin host contributes
// the same shape.
const capabilities: UICapability[] = [];

// registerCapability adds a capability's UI contributions to this surface.
export function registerCapability(capability: UICapability) {
  capabilities.push(capability);
}

// enabled mirrors the launcher's activeProviders gate so one plugins.providers
// toggle governs launcher rows, AI tools, and UI surfaces alike. Called inside a
// $derived, it reacts to live config changes.
function enabled(capability: UICapability): boolean {
  return getConfig("plugins.providers." + capability.id, capability.defaultEnabled);
}

// activeNotchPresences returns the presences for one bar cluster, from enabled
// capabilities, sorted by order.
export function activeNotchPresences(placement: "left" | "right"): NotchPresence[] {
  const presences: NotchPresence[] = [];
  for (const capability of capabilities) {
    if (!enabled(capability) || !capability.notchPresences) {
      continue;
    }
    for (const presence of capability.notchPresences) {
      if (presence.placement === placement) {
        presences.push(presence);
      }
    }
  }
  presences.sort((a, b) => a.order - b.order);
  return presences;
}

// widgetTypes returns the desktop widget types from enabled capabilities.
export function widgetTypes(): WidgetType[] {
  const types: WidgetType[] = [];
  for (const capability of capabilities) {
    if (!enabled(capability) || !capability.widgets) {
      continue;
    }
    types.push(...capability.widgets);
  }
  return types;
}

// widgetType resolves a stored widget's type string to its registered
// definition, or undefined if its capability is disabled or unknown.
export function widgetType(type: string): WidgetType | undefined {
  return widgetTypes().find((candidate) => candidate.type === type);
}
