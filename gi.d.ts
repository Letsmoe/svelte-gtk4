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
