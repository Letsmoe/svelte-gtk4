import GLib from "gi://GLib";
import type { SElement } from "../../dom/nodes";
import type { Mount } from "./base";

export const ROOT_TAG = "gtkroot";

/**
 * The mount target. Its children are windows, which are presented rather than
 * parented into anything, so this is the one mount that is not a widget.
 */
export class Root implements Mount {
  static readonly tag = ROOT_TAG;
  readonly widget = { isRoot: true };

  private pending = new Set<SElement>();

  attr(): boolean {
    return false;
  }

  // Presenting is deferred to the next idle rather than done here. Svelte
  // applies a component's attributes from an effect that runs after the
  // element is inserted, and a layer surface commits its size, layer and
  // anchors the moment it is mapped — presenting immediately would map every
  // window at GTK's 200x200 default and then never shrink it back.
  insert(child: SElement): void {
    this.pending.add(child);
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this.presentIfPending(child);
      return GLib.SOURCE_REMOVE;
    });
  }

  remove(child: SElement): void {
    this.pending.delete(child);
    child.widget.destroy();
  }

  private presentIfPending(child: SElement): void {
    if (!this.pending.delete(child)) {
      return;
    }
    child.widget.present();
  }
}
