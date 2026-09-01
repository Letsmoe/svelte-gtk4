// The node tree and the GTK mirror have to know about each other, and the
// mirror is the half that would otherwise import the node classes it is
// called from. These slots break that cycle: nodes.ts calls them, gtk/mirror.ts
// fills them in.

import type { SNode, SText } from "./nodes";

export interface MirrorHooks {
  inserted(child: SNode): void;
  removed(child: SNode, formerParent: SNode): void;
  textChanged(node: SText): void;
}

export const mirror: MirrorHooks = {
  inserted() {},
  removed() {},
  textChanged() {},
};

export function setMirror(hooks: MirrorHooks): void {
  mirror.inserted = hooks.inserted;
  mirror.removed = hooks.removed;
  mirror.textChanged = hooks.textChanged;
}
