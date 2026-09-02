// core connection to the Go backend
// .svelte.js so runes work outside of components

import type { Monitor, Window, Workspace } from "./types";

let ws: WebSocket = $state<WebSocket>() as WebSocket;
export const connection = $state({ ready: false });

const subscribers = new Map(); // topic → Set of callbacks
const pending: string[] = []; // messages queued before connect

// Resolve the backend WebSocket URL.
// Priority: explicit ?port= passed by the Go webview (works in dev, where the
// page is served by Vite on a different port), then the page's own host (when
// the Go server serves the built frontend directly), then a sane default.
function resolveWsUrl() {
  const port = new URLSearchParams(window.location.search).get("port");
  if (port) {
    return `ws://localhost:${port}/ws`;
  }
  if (window.location.host) {
    return `ws://${window.location.host}/ws`;
  }
  return "ws://localhost:9876/ws";
}

function connect() {
  ws = new WebSocket(resolveWsUrl());

  ws.onopen = () => {
    connection.ready = true;
    // resubscribe to all active topics on reconnect
    for (const topic of subscribers.keys()) {
      ws.send(JSON.stringify({ type: "subscribe", to: topic }));
    }
    // flush queued messages
    for (const msg of pending.splice(0)) {
      ws.send(msg);
    }
  };

  ws.onclose = () => {
    connection.ready = false;
    setTimeout(connect, 2000);
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    const cbs = subscribers.get(msg.type);
    if (cbs) for (const cb of cbs) cb(msg.data);
  };
}

connect();

type TopicDataMap = {
  "hyprland:workspaces": Workspace[];
  "hyprland:activewindow": Window;
  "hyprland:activeworkspace": Workspace;
  "hyprland:windows": Window[];
  "hyprland:monitors": Monitor[];
  "system:volume": { volume: number; muted: boolean };
  "system:battery": { percent: number; charging: boolean; status: string };
  // Averaged colors of the wallpaper strip behind the bar, left to right.
  "theme:bar": { stops: [number, number, number][] };
  // The shell config tree (nested key/value), broadcast on every change.
  config: Record<string, any>;
  // Notification daemon events: an "add" carries the notification, a "close"
  // carries its id. `time` (unix ms) lets the client drop stale replays.
  notification: {
    action: "add" | "close";
    notification?: {
      id: number;
      appName: string;
      appIcon: string;
      summary: string;
      body: string;
      actions: { key: string; label: string }[];
      urgency: number;
      timeout: number;
    };
    id?: number;
    reason?: number;
    time: number;
  };
  // Targeted surface toggle (`neoshell emit surface:toggle <class>`). Each UI
  // surface registers a class name and reacts only when `class` matches.
  "surface:toggle": { class: string; action: "toggle" | "open" | "close" };
  // Timer/tracking state, pushed on every change.
  timer: {
    timers: { id: string; label: string; endsAt: number }[];
    sessions: {
      id: string;
      label: string;
      startedAt: number;
      stoppedAt: number;
    }[];
  };
  // Transient message in the bar, raised by the overlay capability.
  "shell:toast": { text: string; tone: string; ms: number };
  // Widget types registered in the desktop surface's UI capability registry,
  // relayed so the Go core can validate a requested widget. The core is
  // the only consumer; it snoops this on its way through the relay.
  "widgets:types": { types: { type: string; label: string }[] };
  // Minimized floating windows, relayed from a surface that hosts them so the
  // notch (a separate webview) can show restore pills.
  "windows:minimized": { id: string; title: string }[];
  // Restore request for a minimized window, relayed back to that surface.
  "windows:restore": { id: string };
  // Native file drop on a shell surface, forwarded by the render host. Role is
  // the surface's role; coords are surface-local; paths are absolute.
  "surface:drop": { role: string; x: number; y: number; paths: string[] };
  // A file drag entering/leaving a surface ("enter"|"leave"), so a surface can
  // react before the drop (the notch expands as a drag approaches).
  "surface:drag": { role: string; phase: string; x: number; y: number };
  // add more topics and their data types here as needed
};

// subscribe to a topic from the backend, returns an unsubscribe fn
export function subscribe<T extends keyof TopicDataMap>(
  topic: T,
  cb: (data: TopicDataMap[T]) => void,
) {
  if (!subscribers.has(topic)) {
    subscribers.set(topic, new Set());
    send({ type: "subscribe", to: topic });
  }
  subscribers.get(topic).add(cb);

  return () => {
    const cbs = subscribers.get(topic);
    cbs.delete(cb);
    if (cbs.size === 0) {
      subscribers.delete(topic);
      send({ type: "unsubscribe", to: topic });
    }
  };
}

// send a message, queue if not yet connected
export function send(data: Object) {
  const raw = JSON.stringify(data);
  if (connection.ready) {
    ws.send(raw);
  } else {
    pending.push(raw);
  }
}

// relay publishes data to a topic via the backend, which rebroadcasts it to every
// subscriber. Lets one shell surface (webview) push state to another without a
// dedicated Go handler per feature.
export function relay<T extends keyof TopicDataMap>(
  topic: T,
  data: TopicDataMap[T],
) {
  send({ type: "relay", topic, data });
}
