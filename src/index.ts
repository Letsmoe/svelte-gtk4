// Order matters: the DOM globals have to exist before Svelte's client runtime
// is evaluated, and this is the module every entry point imports first.
import "./dom/globals";

import GLib from "gi://GLib";
import Gtk from "gi://Gtk?version=4.0";
import { flushSync, mount } from "svelte";
import { SElement } from "./dom/nodes";
import { ROOT_TAG, install } from "./gtk/mirror";
import { loadStylesheet } from "./gtk/style";

export { loadStylesheet } from "./gtk/style";

export interface StartOptions {
  /** A GTK CSS file to register on the default display before mounting. */
  stylesheet?: string;
}

/**
 * Mounts a component and runs the GTK main loop. The component's root elements
 * must be `<gtkwindow>`s; anything else has nowhere to be presented.
 */
export function start(
  Component: unknown,
  props: Record<string, unknown> = {},
  options: StartOptions = {},
): void {
  // The display does not exist until GTK has been initialized, and widgets are
  // built the moment the component mounts.
  Gtk.init();
  install();

  if (options.stylesheet !== undefined) {
    loadStylesheet(options.stylesheet);
  }

  const root = new SElement(ROOT_TAG);
  mount(Component as any, { target: root as any, props });
  flushSync();

  GLib.MainLoop.new(null, false).run();
}
