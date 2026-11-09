// The messages between a client, where Svelte runs against `dom/`, and the
// host, where `gtk/mirror.ts` draws. Each is one JSON value in a frame: a
// 32-bit little-endian byte length, then that many bytes of UTF-8.
//
// The client only ever describes its tree; it never sees a widget. Every
// element and text node has an id, unique within the client; comments have
// none, because nothing is drawn for them.

export const MAX_FRAME_BYTES = 4 * 1024 * 1024;

// A tree operation is an array whose first item is its code.
export const OP_CREATE_ELEMENT = 0;
export const OP_CREATE_TEXT = 1;
export const OP_SET_TEXT = 2;
export const OP_SET_ATTRIBUTE = 3;
// [OP_INSERT, parent, child, before]: before is 0 for the end.
export const OP_INSERT = 4;
export const OP_REMOVE = 5;
export const OP_LISTEN = 6;
// The node and everything under it is gone for good; its ids are free.
export const OP_DROP = 7;
// [OP_CALL, id, method]: a widget method on the allowlist, like grab_focus.
export const OP_CALL = 8;
// [OP_ROOT, instance, id]: the node an instance's view is mounted into.
export const OP_ROOT = 9;

export type Operation = unknown[];

// What a widget reports with every event: the state a view would otherwise
// read off the widget itself (`event.target.widget.get_text()`).
export interface WidgetState {
  width?: number;
  height?: number;
  // The widget's origin in its window, and the window's size.
  x?: number;
  y?: number;
  rootWidth?: number;
  rootHeight?: number;
  text?: string;
  value?: number;
  active?: boolean;
  selected?: number;
}

// A function in a view's props crosses as this marker, and the client's
// stand-in for it asks the host to call the original.
export const CALLBACK_KEY = "$callback";

// An event the host waits on — the end of a drag whose widgets are held where
// they were let go — carries `answer`; the client sends a batch, empty or not,
// naming it in `answered` once its handlers have run.
export type ClientMessage =
  | { t: "ready" }
  | { t: "batch"; ops: Operation[]; answered?: number }
  | { t: "app"; data: unknown }
  | { t: "pong"; seq: number }
  | { t: "error"; instance: number; message: string }
  | { t: "callback"; instance: number; name: string; args: unknown[] };

export type HostMessage =
  | { t: "mount"; instance: number; view: string; props: Record<string, unknown> }
  | { t: "props"; instance: number; props: Record<string, unknown> }
  | { t: "unmount"; instance: number }
  | { t: "event"; id: number; type: string; detail: unknown; state: WidgetState; answer?: number }
  | { t: "app"; data: unknown }
  | { t: "ping"; seq: number };
