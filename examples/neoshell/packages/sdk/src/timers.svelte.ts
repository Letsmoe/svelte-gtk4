// Reactive view of the core's timer/tracking state, plus commands to mutate it.

import { subscribe, send } from "./connection.svelte.js";
import { invokeCommand } from "./commands.js";

export type Timer = { id: string; label: string; endsAt: number };
export type Session = {
  id: string;
  label: string;
  startedAt: number;
  stoppedAt: number;
};

export const timers = $state<{ timers: Timer[]; sessions: Session[] }>({
  timers: [],
  sessions: [],
});

let started = false;
export function ensureTimers() {
  if (started) {
    return;
  }
  started = true;
  subscribe("timer", (data) => {
    timers.timers = data.timers ?? [];
    timers.sessions = data.sessions ?? [];
  });
  send({ type: "timer:list" });
}

// Mutations route through the shared command registry so the launcher and the
// AI drive timers through one backend path. Live state still arrives on the
// "timer" topic subscribed above.
export function startTimer(label: string, seconds: number) {
  invokeCommand("timer:start", { label, seconds });
}

export function stopTimer(id: string) {
  invokeCommand("timer:stop", { id });
}

export function startTrack(label: string) {
  invokeCommand("track:start", { label });
}

export function stopTrack(id: string) {
  invokeCommand("track:stop", { id });
}
