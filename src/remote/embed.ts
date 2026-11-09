// `<gtkembed view="…" props={…}>`: a box in a client's tree that the host
// fills with a view of its own choosing, which can be another client's. The
// client names the view and its props; what that view draws never passes
// through the client, and the client cannot put children of its own there.

import { SElement } from "../dom/nodes";

export const EMBED_TAG = "gtkembed";

export interface EmbeddedView {
  update(props: unknown): void;
  dispose(): void;
}

export interface Embedder {
  /** Fills `anchor` with `view`, or answers null to leave it empty. */
  embed(anchor: SElement, view: string, props: unknown): EmbeddedView | null;
}

interface Embed {
  view: string;
  props: unknown;
  shown: EmbeddedView | null;
  shownView: string;
}

export class EmbedTable {
  private readonly embedder: Embedder | null;
  private readonly embeds = new Map<SElement, Embed>();

  constructor(embedder: Embedder | null) {
    this.embedder = embedder;
  }

  /** The box an embed is drawn in; a plain one the host owns. */
  create(): SElement {
    const anchor = new SElement("gtkbox");
    this.embeds.set(anchor, { view: "", props: null, shown: null, shownView: "" });
    return anchor;
  }

  isEmbed(node: unknown): boolean {
    return node instanceof SElement && this.embeds.has(node);
  }

  /** Takes `view` and `props`; answers false for an attribute the box itself handles. */
  setAttribute(anchor: SElement, name: string, value: unknown): boolean {
    const embed = this.embeds.get(anchor);
    if (embed === undefined || (name !== "view" && name !== "props")) {
      return false;
    }
    if (name === "view") {
      embed.view = viewNameOf(value);
    } else {
      embed.props = value;
    }
    this.show(anchor, embed);
    return true;
  }

  dispose(anchor: SElement): void {
    const embed = this.embeds.get(anchor);
    if (embed === undefined) {
      return;
    }
    this.embeds.delete(anchor);
    hide(embed);
  }

  disposeAll(): void {
    for (const embed of this.embeds.values()) {
      hide(embed);
    }
    this.embeds.clear();
  }

  private show(anchor: SElement, embed: Embed): void {
    if (embed.shown !== null && embed.shownView === embed.view) {
      embed.shown.update(embed.props);
      return;
    }
    hide(embed);
    if (this.embedder === null || embed.view === "") {
      return;
    }
    embed.shown = this.embedder.embed(anchor, embed.view, embed.props);
    embed.shownView = embed.view;
  }
}

function viewNameOf(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value;
}

function hide(embed: Embed): void {
  if (embed.shown === null) {
    return;
  }
  try {
    embed.shown.dispose();
  } catch (error) {
    console.warn("svelte-gtk4 host: disposing an embedded view:", error);
  }
  embed.shown = null;
  embed.shownView = "";
}
