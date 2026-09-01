<script lang="ts">
  import type { BusClient } from "./bus";
  import Notch from "./Notch.svelte";
  import {
    activeIdOf,
    urgentAddressOf,
    windowWorkspacesOf,
    workspacesOf,
  } from "./hypr";
  import type { WorkspaceEntry } from "./hypr";

  const BAR_HEIGHT = 30;
  const CENTER_GAP = 320;
  // Tall enough for the expanded media island; only BAR_HEIGHT is reserved.
  const SURFACE_HEIGHT = 180;

  const DEMO_WORKSPACES: WorkspaceEntry[] = [
    { id: 1, name: "1", occupied: true },
    { id: 2, name: "2", occupied: true },
    { id: 3, name: "3", occupied: false },
    { id: 4, name: "4", occupied: false },
  ];

  // SpiderMonkey ships full ICU, so these formatters port from the webview
  // Clock as-is.
  const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  let { bus }: { bus: BusClient } = $props();

  let workspaces = $state<WorkspaceEntry[]>(bus.connected ? [] : DEMO_WORKSPACES);
  let activeId = $state(bus.connected ? -1 : 2);
  let urgentIds = $state<ReadonlySet<number>>(new Set());
  let now = $state(new Date());

  let byWindowAddress = new Map<string, number>();

  // The subscription is set up once: the handler runs long after the effect
  // has finished, so nothing it reads becomes a dependency.
  $effect(() =>
    bus.subscribe("hypr.workspaces", (message) => {
      workspaces = workspacesOf(message.data);
    })
  );

  $effect(() =>
    bus.subscribe("hypr.activeworkspace", (message) => {
      activeId = activeIdOf(message.data);
      urgentIds = without(urgentIds, activeId);
    })
  );

  $effect(() =>
    bus.subscribe("hypr.windows", (message) => {
      byWindowAddress = windowWorkspacesOf(message.data);
    })
  );

  $effect(() =>
    bus.subscribe("hypr.event", (message) => {
      markUrgent(urgentAddressOf(message.data));
    })
  );

  $effect(() => {
    const timer = setInterval(() => {
      now = new Date();
    }, 1000);
    return () => clearInterval(timer);
  });

  function markUrgent(address: string | null): void {
    if (address === null) {
      return;
    }
    const workspaceId = byWindowAddress.get(address);
    if (workspaceId === undefined || workspaceId === activeId) {
      return;
    }
    urgentIds = new Set(urgentIds).add(workspaceId);
  }

  function activate(workspace: WorkspaceEntry): void {
    // The host echoes hypr.activeworkspace back; with no host connected the
    // bar would otherwise never react.
    activeId = workspace.id;
    bus.call("hypr:dispatch", {
      dispatcher: "workspace",
      arg: String(workspace.id),
    });
  }

  function stateOf(workspace: WorkspaceEntry): string {
    if (urgentIds.has(workspace.id)) {
      return "urgent";
    }
    if (workspace.id === activeId) {
      return "active";
    }
    if (workspace.occupied) {
      return "occupied";
    }
    return "empty";
  }

  function without(
    set: ReadonlySet<number>,
    id: number,
  ): ReadonlySet<number> {
    if (!set.has(id)) {
      return set;
    }
    const remaining = new Set(set);
    remaining.delete(id);
    return remaining;
  }
</script>

<!-- One surface per layer, as the view tree plans it: the bar is the main
     child and the notch paints over its centre gap. The surface is taller than
     the bar so an expanded island has room, but reserves only the bar's
     height. -->
<gtkwindow
  layer="top"
  namespace="neoshell.spike-bar"
  anchor="top left right"
  exclusive-zone={BAR_HEIGHT}
  keyboard-mode="ondemand"
  decorated={false}
>
  <gtkoverlay height={SURFACE_HEIGHT}>
    <gtkbox orientation="vertical">
      <!-- The surface is 180px tall so the island has room to open, but only
           the bar strip and the island itself should take clicks; without
           `input` the empty space below them would swallow every click in the
           top 180px of the screen. -->
      <gtkcenterbox
        class="topbar"
        orientation="horizontal"
        height={BAR_HEIGHT}
        input
      >
        <gtkbox
          place="start"
          orientation="horizontal"
          spacing={4}
          valign="center"
          halign="start"
        >
          {#each workspaces as workspace (workspace.id)}
            <gtkbutton
              class="workspace {stateOf(workspace)}"
              frame={false}
              onclicked={() => activate(workspace)}
            >
              {workspace.name}
            </gtkbutton>
          {/each}
        </gtkbox>

        <!-- The notch gap: a fixed-width centre slot the CenterBox keeps
             centred. -->
        <gtkbox place="center" width={CENTER_GAP} />

        <gtkbutton
          place="end"
          class="clock"
          frame={false}
          tooltip="Quick settings"
          valign="center"
          halign="end"
          onclicked={() => bus.publish("quicksettings:toggle", {})}
        >
          <gtkbox orientation="horizontal" spacing={8}>
            <gtklabel class="clock-date">{DATE_FORMAT.format(now)}</gtklabel>
            <gtklabel tabular>{TIME_FORMAT.format(now)}</gtklabel>
          </gtkbox>
        </gtkbutton>
      </gtkcenterbox>

      <gtkbox vexpand />
    </gtkbox>

    <Notch {bus} />
  </gtkoverlay>
</gtkwindow>
