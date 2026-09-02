import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool } from "../attrs";
import { Editable } from "./editable";

/** A label until it is clicked, an entry after. Signal: `changed`. */
export class GtkEditableLabel extends Editable<Gtk.EditableLabel> {
  static override readonly tag = "gtkeditablelabel";

  constructor(node: SElement) {
    super(node, new Gtk.EditableLabel({ text: "" }));
  }

  override attr(name: string, value: unknown): boolean {
    if (name === "editing") {
      if (asBool(value)) {
        this.widget.start_editing();
      } else {
        this.widget.stop_editing(true);
      }
      return true;
    }
    return super.attr(name, value);
  }
}
