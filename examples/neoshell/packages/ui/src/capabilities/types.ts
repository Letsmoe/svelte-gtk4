import type { Component } from "svelte";

// UI capabilities are the frontend half of the shared plugin model. A capability
// groups a plugin's on-screen contributions under one id that matches its
// backend counterpart and its plugins.providers.<id> toggle, so a single switch
// governs the launcher provider, the AI tools, and the UI surfaces together.
//
// Contributions render into slot hosts: notch presences mount in the bar,
// widgets mount on the desktop. The host owns layout; the plugin owns content.

// NotchPresence is a dynamic element in the bar's presence slot — a timer
// countdown, an activity badge, an alert. It mounts only while `visible` is
// true, so an idle plugin adds no chrome.
export interface NotchPresence {
  id: string;
  // Component renders the presence and reads its own reactive state; the host
  // passes no props. Typed permissively because presences are heterogeneous.
  component: Component<any>;
  placement: "left" | "right";
  order: number;
  visible(): boolean;
}

// Props every desktop widget component receives. Non-editable widgets (a clock)
// ignore them; editable ones (a sticky note) use them to persist content.
export interface WidgetProps {
  text?: string;
  onChange?: (value: string) => void;
}

// WidgetType contributes a draggable desktop tile. `type` is stored on the
// widget instance in desktop.widgets; the desktop's add menu is built from the
// registered types' labels.
export interface WidgetType {
  type: string;
  label: string;
  // Typed permissively so components with differing prop shapes can share one
  // registry; the desktop passes WidgetProps and unused props are ignored.
  component: Component<any>;
  defaultWidth: number;
  defaultHeight: number;
  editable: boolean;
}

export interface UICapability {
  id: string;
  defaultEnabled: boolean;
  notchPresences?: NotchPresence[];
  widgets?: WidgetType[];
}
