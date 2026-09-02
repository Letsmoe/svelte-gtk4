import { subscribe, send } from "./connection.svelte.js";
import type { Monitor, Window, Workspace } from "./types.js";

// each binding returns a $state object that stays in sync with the backend
// call it once at the top of your component, use it directly in the template

export function workspaces({ monitor }: { monitor?: Monitor } = {}) {
  let workspaces = $state<{ list: Workspace[]; active: number | null }>({
    list: [],
    active: null,
  });

  const unsubActive = subscribe("hyprland:activeworkspace", (data) => {
    if (monitor) {
      if (data.monitor === monitor.name) {
        workspaces.active = data.id;
      }
    } else {
      workspaces.active = data.id;
    }
  });

  const unsubList = subscribe("hyprland:workspaces", (data) => {
    if (monitor) {
      workspaces.list = data.filter((ws) => ws.monitor === monitor.name);
    } else {
      workspaces.list = data;
    }
  });

  $effect(() => () => {
    unsubActive();
    unsubList();
  });

  return workspaces;
}

export function windows() {
  let state = $state<{ windows: Window[] }>({ windows: [] });

  const unsub = subscribe("hyprland:windows", (data) => {
    state.windows = data;
  });

  $effect(() => () => unsub());

  return state;
}

export function activeWindow() {
  let state = $state<{ window: Window | null }>({ window: null });

  const unsub = subscribe("hyprland:activewindow", (data) => {
    state.window = data;
  });

  $effect(() => () => unsub());

  return state;
}

export function monitors() {
  let state = $state<Monitor[]>([]);

  const unsub = subscribe("hyprland:monitors", (data) => {
    state = data;
  });

  $effect(() => () => unsub());

  return state;
}

// fire and forget — switch workspace, move window, etc
export function dispatch(dispatcher, arg) {
  send({ type: "hyprland:dispatch", dispatcher, arg });
}

// listen to raw hyprland events if you need something not in the SDK
export function onEvent(cb) {
  const unsub = subscribe("hyprland:event", cb);
  $effect(() => () => unsub());
}
