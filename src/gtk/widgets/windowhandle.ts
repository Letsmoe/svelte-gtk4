import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { Bin } from "./base";

/** Makes its child a drag area for moving the window it sits in. */
export class GtkWindowHandle extends Bin<Gtk.WindowHandle> {
  static override readonly tag = "gtkwindowhandle";

  constructor(node: SElement) {
    super(node, new Gtk.WindowHandle());
  }
}
