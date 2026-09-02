// Reactive list of installed applications (from the Go core's .desktop parser).
// Used by the desktop's "Add app" picker.
import { subscribe, send } from "./connection.svelte.js";

export type App = {
  id: string;
  name: string;
  exec: string;
  icon: string;
  categories?: string[];
};

export const apps = $state<{ list: App[] }>({ list: [] });

let started = false;

// ensureApps requests the app list once and keeps it updated. Safe to call from
// any component that shows apps.
export function ensureApps() {
  if (started) {
    return;
  }
  started = true;
  subscribe("apps", (data: App[]) => {
    apps.list = data ?? [];
  });
  send({ type: "apps:list" });
}
