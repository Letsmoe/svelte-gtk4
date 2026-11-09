// A client the host keeps alive: one runner process, the views it has mounted
// and the tree they draw into. When the process dies, for whatever reason, its
// views come off screen, and after a backoff a fresh process mounts them again
// with their latest props. A client that keeps dying is given up on.
//
// The host also guards its own time: applying a client's operations is
// measured, and a client that takes more than its share of the main loop is
// read from less often.

import GLib from "gi://GLib";
import type { SElement } from "../dom/nodes";
import { ProtocolError, RemoteTree } from "./host";
import type { Embedder } from "./embed";
import type { Policy } from "./policy";
import { ClientProcess } from "./process";
import type { ClientMessage, HostMessage } from "./protocol";

export type ClientStatus = "starting" | "running" | "restarting" | "failed";

export interface RemoteClientOptions {
  /** Shown in logs. */
  name: string;
  /** The runner's command line for this client, sandbox included. */
  argv: string[];
  policy: Policy;
  /** Messages from the client's app layer; reply with `sendApp`. */
  onApp?(data: unknown): void;
  /** An app message every new process gets first, before any view mounts. */
  greeting?(): unknown;
  /** Fills the client's `<gtkembed>` boxes; without it they stay empty. */
  embedder?: Embedder;
  /** The client's status changed, or one of its views failed to mount. */
  onStatus?(status: ClientStatus, detail: string): void;
}

interface MountedView {
  view: string;
  props: Record<string, unknown>;
  anchor: SElement;
}

const PING_EVERY_MS = 2000;
const MISSED_PINGS_ALLOWED = 3;
const RESTART_DELAYS_MS = [500, 1000, 2000, 4000, 8000];
const CRASH_WINDOW_MS = 60_000;
// Of every second of the host's main loop, how much one client may spend.
const APPLY_BUDGET_MS = 100;
const APPLY_WINDOW_MS = 1000;

export class RemoteClient {
  private readonly options: RemoteClientOptions;
  private readonly tree: RemoteTree;
  private readonly views = new Map<number, MountedView>();
  private process: ClientProcess | null = null;
  private ready = false;
  private stopped = false;
  private nextInstance = 1;
  private crashes: number[] = [];
  private pingTimer = 0;
  private restartTimer = 0;
  private pingSequence = 0;
  private answeredSequence = 0;
  private applyWindowStart = 0;
  private applySpent = 0;
  status: ClientStatus = "starting";

  constructor(options: RemoteClientOptions) {
    this.options = options;
    this.tree = new RemoteTree(options.policy, (message) => this.send(message), embedderOf(options));
  }

  start(): void {
    this.stopped = false;
    this.spawn();
  }

  /** Mounts a view into `anchor`; answers the instance, which stays valid across restarts. */
  mount(view: string, props: Record<string, unknown>, anchor: SElement): number {
    const instance = this.nextInstance++;
    this.views.set(instance, { view, props, anchor });
    this.tree.attach(instance, anchor);
    if (this.ready) {
      this.send({ t: "mount", instance, view, props });
    }
    return instance;
  }

  update(instance: number, props: Record<string, unknown>): void {
    const mounted = this.views.get(instance);
    if (mounted === undefined) {
      return;
    }
    mounted.props = props;
    if (this.ready) {
      this.send({ t: "props", instance, props });
    }
  }

  unmount(instance: number): void {
    if (!this.views.delete(instance)) {
      return;
    }
    this.tree.detach(instance);
    if (this.ready) {
      this.send({ t: "unmount", instance });
    }
  }

  sendApp(data: unknown): void {
    if (this.ready) {
      this.send({ t: "app", data });
    }
  }

  /** Starts over after the client was given up on. */
  retry(): void {
    if (this.status !== "failed") {
      return;
    }
    this.crashes = [];
    this.spawn();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.process !== null) {
      this.process.kill("the host stopped it");
    }
  }

  private spawn(): void {
    this.ready = false;
    this.setStatus("starting", "");
    this.answeredSequence = this.pingSequence;
    this.process = new ClientProcess({
      argv: this.options.argv,
      label: this.options.name,
      onMessage: (message) => this.receive(message),
      onExit: (reason) => this.exited(reason),
    });
    this.process.start();
    this.pingTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PING_EVERY_MS, () => this.ping());
  }

  private receive(message: ClientMessage): void {
    switch (message.t) {
      case "ready":
        this.becameReady();
        return;
      case "batch":
        this.applyBatch(message.ops);
        return;
      case "app":
        if (this.options.onApp !== undefined) {
          this.options.onApp(message.data);
        }
        return;
      case "pong":
        this.answered(message.seq);
        return;
      case "error":
        console.warn(`${this.options.name}: view ${message.instance}: ${message.message}`);
        this.notify("running", String(message.message));
        return;
      default:
        this.kill("sent a message the protocol does not have");
    }
  }

  private becameReady(): void {
    if (this.ready) {
      return;
    }
    this.ready = true;
    if (this.options.greeting !== undefined) {
      this.send({ t: "app", data: this.options.greeting() });
    }
    this.setStatus("running", "");
    for (const [instance, mounted] of this.views) {
      this.send({ t: "mount", instance, view: mounted.view, props: mounted.props });
    }
  }

  private applyBatch(ops: unknown): void {
    const started = GLib.get_monotonic_time() / 1000;
    try {
      this.tree.apply(ops);
    } catch (error) {
      if (!(error instanceof ProtocolError)) {
        console.error(`${this.options.name}: applying a batch:`, error);
      }
      this.kill(`broke the protocol: ${String(error)}`);
      return;
    }
    this.chargeTime(started);
  }

  private chargeTime(started: number): void {
    const now = GLib.get_monotonic_time() / 1000;
    if (now - this.applyWindowStart > APPLY_WINDOW_MS) {
      this.applyWindowStart = now;
      this.applySpent = 0;
    }
    this.applySpent += now - started;
    if (this.applySpent > APPLY_BUDGET_MS && this.process !== null) {
      this.process.pause(Math.max(1, APPLY_WINDOW_MS - (now - this.applyWindowStart)));
    }
  }

  private answered(sequence: unknown): void {
    if (typeof sequence !== "number") {
      return;
    }
    this.answeredSequence = Math.max(this.answeredSequence, sequence);
  }

  private ping(): boolean {
    if (this.pingSequence - this.answeredSequence >= MISSED_PINGS_ALLOWED) {
      this.kill("stopped answering");
      return GLib.SOURCE_REMOVE;
    }
    this.pingSequence += 1;
    this.send({ t: "ping", seq: this.pingSequence });
    return GLib.SOURCE_CONTINUE;
  }

  private send(message: HostMessage): void {
    if (this.process !== null) {
      this.process.send(message);
    }
  }

  private kill(reason: string): void {
    if (this.process !== null) {
      this.process.kill(reason);
    }
  }

  private exited(reason: string): void {
    this.ready = false;
    this.process = null;
    this.clearTimers();
    this.tree.reset();
    if (this.stopped) {
      return;
    }
    console.warn(`${this.options.name}: ${reason}`);
    const now = GLib.get_monotonic_time() / 1000;
    this.crashes = this.crashes.filter((at) => now - at < CRASH_WINDOW_MS);
    this.crashes.push(now);
    if (this.crashes.length > RESTART_DELAYS_MS.length) {
      this.setStatus("failed", reason);
      return;
    }
    this.setStatus("restarting", reason);
    const delay = RESTART_DELAYS_MS[this.crashes.length - 1];
    this.restartTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
      this.restartTimer = 0;
      this.spawn();
      return GLib.SOURCE_REMOVE;
    });
  }

  private clearTimers(): void {
    if (this.pingTimer !== 0) {
      GLib.source_remove(this.pingTimer);
      this.pingTimer = 0;
    }
    if (this.restartTimer !== 0) {
      GLib.source_remove(this.restartTimer);
      this.restartTimer = 0;
    }
  }

  private setStatus(status: ClientStatus, detail: string): void {
    this.status = status;
    this.notify(status, detail);
  }

  private notify(status: ClientStatus, detail: string): void {
    if (this.options.onStatus !== undefined) {
      this.options.onStatus(status, detail);
    }
  }
}

function embedderOf(options: RemoteClientOptions): Embedder | null {
  if (options.embedder === undefined) {
    return null;
  }
  return options.embedder;
}
