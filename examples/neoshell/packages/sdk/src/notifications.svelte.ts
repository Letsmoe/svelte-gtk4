// Active notifications mirrored from the Go notification daemon. The daemon owns
// the freedesktop D-Bus service and pushes add/close events over the WS bus; this
// holds the live list, schedules expiry, and reports user actions back.
import { subscribe, send } from "./connection.svelte.js";

export type NotificationAction = { key: string; label: string };

export type Notification = {
  id: number;
  appName: string;
  appIcon: string;
  summary: string;
  body: string;
  actions: NotificationAction[];
  urgency: number; // 0 low, 1 normal, 2 critical
  timeout: number; // ms; -1 default, 0 never
};

const DEFAULT_TIMEOUT_MS = 5000;
const STALE_MS = 8000; // ignore replayed events older than this (hub hydration)

const REASON_EXPIRED = 1;
const REASON_DISMISSED = 2;

export const notifications = $state<{ active: Notification[] }>({ active: [] });

const timers = new Map<number, ReturnType<typeof setTimeout>>();
let started = false;

// ensureNotifications wires the subscription once. Safe to call from any component.
export function ensureNotifications() {
  if (started) {
    return;
  }
  started = true;
  subscribe("notification", (event) => {
    if (Date.now() - event.time > STALE_MS) {
      return;
    }
    if (event.action === "add" && event.notification) {
      addNotification(event.notification);
      return;
    }
    if (event.action === "close" && event.id != null) {
      removeLocal(event.id);
    }
  });
}

function addNotification(notification: Notification) {
  const index = notifications.active.findIndex((n) => n.id === notification.id);
  if (index >= 0) {
    notifications.active[index] = notification;
  } else {
    notifications.active.push(notification);
  }
  scheduleExpiry(notification);
}

function scheduleExpiry(notification: Notification) {
  clearTimer(notification.id);
  // Critical notifications and timeout 0 never auto-expire.
  if (notification.urgency >= 2 || notification.timeout === 0) {
    return;
  }
  const ms = notification.timeout > 0 ? notification.timeout : DEFAULT_TIMEOUT_MS;
  timers.set(
    notification.id,
    setTimeout(() => dismiss(notification.id, REASON_EXPIRED), ms),
  );
}

function clearTimer(id: number) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

function removeLocal(id: number) {
  clearTimer(id);
  notifications.active = notifications.active.filter((n) => n.id !== id);
}

// dismiss removes a notification locally and tells the core to emit NotificationClosed.
export function dismiss(id: number, reason = REASON_DISMISSED) {
  removeLocal(id);
  send({ type: "notification:close", notifId: id, reason });
}

// invokeAction triggers a notification's action (the core emits ActionInvoked).
export function invokeAction(id: number, key: string) {
  removeLocal(id);
  send({ type: "notification:action", notifId: id, actionKey: key });
}
