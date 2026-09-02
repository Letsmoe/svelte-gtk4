import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Socket } from "bun";
import { Context } from "@neoworks/extension-system";
import type { Fiber } from "@neoworks/extension-system";
import hyprExtension, { resolveInstanceDir } from "../hypr/backend.js";
import { busProvider, FakeBus, waitFor } from "./helpers.js";

// FakeHyprland: the two IPC sockets with mutable state. The request socket
// answers one command per connection and closes, like the real compositor;
// the event socket streams lines to every connected client.
class FakeHyprland {
  state: Record<string, unknown> = {
    clients: [{ class: "firefox", title: "Mozilla Firefox" }],
    workspaces: [{ id: 1, name: "1" }],
    activeworkspace: { id: 1, name: "1" },
    activewindow: { class: "firefox" },
    monitors: [{ id: 0, name: "DP-2" }],
  };
  readonly commands: string[] = [];
  private requestListener: { stop(closeActive?: boolean): void } | null = null;
  private eventListener: { stop(closeActive?: boolean): void } | null = null;
  private readonly eventClients = new Set<Socket<undefined>>();

  start(requestSocket: string, eventSocket: string): void {
    const fake = this;
    this.requestListener = Bun.listen<undefined>({
      unix: requestSocket,
      socket: {
        data(socket, chunk) {
          fake.answer(socket, chunk.toString());
        },
      },
    });
    this.eventListener = Bun.listen<undefined>({
      unix: eventSocket,
      socket: {
        open(socket) {
          fake.eventClients.add(socket);
        },
        close(socket) {
          fake.eventClients.delete(socket);
        },
        data() {},
      },
    });
  }

  stop(): void {
    if (this.requestListener !== null) {
      this.requestListener.stop(true);
    }
    if (this.eventListener !== null) {
      this.eventListener.stop(true);
    }
  }

  emitEvent(line: string): void {
    for (const client of this.eventClients) {
      client.write(line + "\n");
    }
  }

  private answer(socket: Socket<undefined>, command: string): void {
    this.commands.push(command);
    socket.write(this.replyFor(command));
    socket.end();
  }

  private replyFor(command: string): string {
    if (command.startsWith("j/")) {
      const query = command.slice(2);
      return JSON.stringify(this.state[query]);
    }
    return "ok";
  }
}

describe("hypr extension", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "neoshell-hypr-test-"));
  const requestSocket = join(tempDir, "request.sock");
  const eventSocket = join(tempDir, "events.sock");
  const fake = new FakeHyprland();
  const root = new Context();
  const bus = new FakeBus();
  let fiber = null as unknown as Fiber;

  beforeAll(async () => {
    fake.start(requestSocket, eventSocket);
    await root.plugin(busProvider(bus));
    fiber = await root.plugin(hyprExtension, { requestSocket, eventSocket });
  });

  afterAll(async () => {
    await root.fiber.dispose();
    fake.stop();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("publishes the compositor state as retained topics on start", async () => {
    await waitFor(() => bus.retained.has("hypr.monitors"));

    expect(bus.retained.get("hypr.windows")).toEqual([
      { class: "firefox", title: "Mozilla Firefox" },
    ]);
    expect(bus.retained.get("hypr.activeworkspace")).toEqual({
      id: 1,
      name: "1",
    });
  });

  test("a compositor event publishes hypr.event and refreshes the snapshots", async () => {
    fake.state.clients = [{ class: "kitty", title: "kitty" }];
    fake.emitEvent("openwindow>>abc123,1,kitty,kitty");

    await waitFor(() =>
      bus.published.some((message) => message.type === "hypr.event"),
    );
    const event = bus.published.find(
      (message) => message.type === "hypr.event",
    );
    expect(event?.data).toEqual({
      event: "openwindow",
      data: "abc123,1,kitty,kitty",
    });

    await waitFor(() => {
      const windows = bus.retained.get("hypr.windows") as Array<{
        class: string;
      }>;
      return windows[0].class === "kitty";
    });
  });

  test("hypr:dispatch reaches the compositor socket", async () => {
    const reply = (await bus.call("hypr:dispatch", {
      dispatcher: "exec",
      arg: "kitty",
    })) as {
      ok?: boolean;
    };
    expect(reply.ok).toBe(true);
    await waitFor(() => fake.commands.includes("dispatch exec kitty"));
  });

  test("hypr:request returns the raw reply, invalid calls return errors", async () => {
    const reply = (await bus.call("hypr:request", { command: "version" })) as {
      reply?: string;
    };
    expect(reply.reply).toBe("ok");

    const bad = (await bus.call("hypr:dispatch", {})) as { error?: string };
    expect(bad.error).toContain("required");
  });

  test("disposal withdraws every retained topic", async () => {
    await fiber.dispose();
    expect(bus.retained.size).toBe(0);
  });
});

describe("instance directory resolution", () => {
  const root = mkdtempSync(join(tmpdir(), "neoshell-hypr-instances-"));
  const stale = join(root, "stale_1");
  const live = join(root, "live_2");

  beforeAll(() => {
    mkdirSync(stale, { recursive: true });
    mkdirSync(live, { recursive: true });
    writeFileSync(join(live, ".socket.sock"), "");
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("a signature with a live socket wins", () => {
    expect(resolveInstanceDir(root, "live_2")).toBe(live);
  });

  test("a stale signature falls back to an instance that still has a socket", () => {
    expect(resolveInstanceDir(root, "stale_1")).toBe(live);
    expect(resolveInstanceDir(root, undefined)).toBe(live);
  });

  test("no live instance is an error, not a silent dead socket path", () => {
    const empty = mkdtempSync(join(tmpdir(), "neoshell-hypr-empty-"));
    expect(() => resolveInstanceDir(empty, "whatever")).toThrow(
      "no live compositor instance",
    );
    rmSync(empty, { recursive: true, force: true });
  });
});
