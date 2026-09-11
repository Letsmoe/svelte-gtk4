/// <reference types="gjs-esm-types" />

declare module "gi://Gtk" {
  import Gtk from "gi://Gtk?version=4.0";
  export default Gtk;
}

declare module "gi://Gdk" {
  import Gdk from "gi://Gdk?version=4.0";
  export default Gdk;
}

declare module "gi://GLib" {
  import GLib from "gi://GLib?version=2.0";
  export default GLib;
}

declare module "gi://GdkPixbuf" {
  import GdkPixbuf from "gi://GdkPixbuf?version=2.0";
  export default GdkPixbuf;
}

declare module "gi://Gio" {
  import Gio from "gi://Gio?version=2.0";
  export default Gio;
}

declare module "gi://Pango" {
  import Pango from "gi://Pango?version=1.0";
  export default Pango;
}

declare module "gi://GObject" {
  import GObject from "gi://GObject?version=2.0";
  export default GObject;
}

declare module "gi://cairo" {
  namespace cairo {
    class Region {
      unionRectangle(
        rect: { x: number; y: number; width: number; height: number },
      ): void;
      numRectangles(): number;
    }
  }

  export default cairo;
}

declare module "gi://Gtk4LayerShell?version=1.0" {
  import type Gtk from "gi://Gtk?version=4.0";

  namespace LayerShell {
    function init_for_window(window: Gtk.Window): void;
    function is_layer_window(window: Gtk.Window): boolean;
    function set_namespace(window: Gtk.Window, name: string): void;
    function set_layer(window: Gtk.Window, layer: number): void;
    function set_anchor(window: Gtk.Window, edge: number, anchor: boolean): void;
    function set_margin(window: Gtk.Window, edge: number, margin: number): void;
    function set_exclusive_zone(window: Gtk.Window, zone: number): void;
    function auto_exclusive_zone_enable(window: Gtk.Window): void;
    function set_keyboard_mode(window: Gtk.Window, mode: number): void;
    function set_monitor(window: Gtk.Window, monitor: unknown): void;
  }

  export default LayerShell;
}

declare module "gi://Gtk4LayerShell" {
  import LayerShell from "gi://Gtk4LayerShell?version=1.0";
  export default LayerShell;
}

// gjs-esm-types ships no GStreamer typings. This is the slice neoshell's live
// wallpaper uses, typed by hand against the 1.0 GIR.
declare module "gi://Gst?version=1.0" {
  import type GObject from "gi://GObject?version=2.0";

  namespace Gst {
    const CLOCK_TIME_NONE: number;

    enum State {
      VOID_PENDING,
      NULL,
      READY,
      PAUSED,
      PLAYING,
    }

    enum Format {
      UNDEFINED,
      DEFAULT,
      BYTES,
      TIME,
      BUFFERS,
      PERCENT,
    }

    enum SeekType {
      NONE,
      SET,
      END,
    }

    enum SeekFlags {
      NONE = 0,
      FLUSH = 1,
      ACCURATE = 2,
      KEY_UNIT = 4,
      SEGMENT = 8,
      TRICKMODE = 16,
    }

    enum MessageType {
      EOS = 1,
      ERROR = 2,
      WARNING = 4,
      SEGMENT_DONE = 1 << 10,
      ASYNC_DONE = 1 << 17,
    }

    enum StateChangeReturn {
      FAILURE,
      SUCCESS,
      ASYNC,
      NO_PREROLL,
    }

    class Message {
      readonly type: MessageType;
      readonly src: GObject.Object | null;
      parse_error(): [Error, string];
    }

    class Bus extends GObject.Object {
      add_signal_watch(): void;
      remove_signal_watch(): void;
      connect(signal: string, handler: (bus: Bus, message: Message) => void): number;
      disconnect(id: number): void;
    }

    class Element extends GObject.Object {
      set_property(name: string, value: unknown): void;
      get_property<T = unknown>(name: string): T;
      set_state(state: State): StateChangeReturn;
      get_bus(): Bus | null;
      seek(
        rate: number,
        format: Format,
        flags: number,
        startType: SeekType,
        start: number,
        stopType: SeekType,
        stop: number,
      ): boolean;
      query_position(format: Format): [boolean, number];
    }

    namespace ElementFactory {
      function make(factoryName: string, name: string | null): Element | null;
      function find(factoryName: string): GObject.Object | null;
    }

    function init(argv: string[] | null): void;
    function is_initialized(): boolean;
    function filename_to_uri(filename: string): string;
  }

  export default Gst;
}

declare module "gi://Gst" {
  import Gst from "gi://Gst?version=1.0";
  export default Gst;
}

// gtk4-layer-shell ≥ 1.3 ships the session-lock half in the same library, so
// the LD_PRELOAD that loads the layer shell loads this too.
declare module "gi://Gtk4SessionLock?version=1.0" {
  import type Gdk from "gi://Gdk?version=4.0";
  import type GObject from "gi://GObject?version=2.0";
  import type Gtk from "gi://Gtk?version=4.0";

  namespace SessionLock {
    class Instance extends GObject.Object {
      constructor();
      lock(): boolean;
      unlock(): void;
      is_locked(): boolean;
      assign_window_to_monitor(window: Gtk.Window, monitor: Gdk.Monitor): void;
      connect(signal: "locked" | "failed" | "unlocked", handler: () => void): number;
      connect(signal: "monitor", handler: (self: Instance, monitor: Gdk.Monitor) => void): number;
      disconnect(id: number): void;
    }
    function is_supported(): boolean;
  }

  export default SessionLock;
}

declare module "gi://Gtk4SessionLock" {
  import SessionLock from "gi://Gtk4SessionLock?version=1.0";
  export default SessionLock;
}
