// The library must be imported before anything that pulls in Svelte's client
// runtime: it installs the DOM globals that runtime reads at module scope.
import { start } from "@neoworks/svelte-gtk4";
import GLib from "gi://GLib";
import { BusClient, busSocketPath } from "./bus";
import Topbar from "./Topbar.svelte";

const bus = new BusClient();
if (!bus.open(busSocketPath())) {
  print("topbar: host socket not found, showing demo content");
}

start(Topbar, { bus }, {
  stylesheet: GLib.build_filenamev([GLib.get_current_dir(), "style.css"]),
});
