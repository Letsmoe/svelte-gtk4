// The library must be imported before anything that pulls in Svelte's client
// runtime: it installs the DOM globals that runtime reads at module scope.
import { start } from "@neoworks/svelte-gtk4";
import GLib from "gi://GLib";
import System from "system";
import Gallery from "./Gallery.svelte";

// Every tag in the registry, built once — so a wrong method name or a GTK
// version mismatch shows up as a crash rather than as a missing widget.
// `GALLERY_EXIT_AFTER=<ms>` turns it into a smoke test.
const exitAfter = GLib.getenv("GALLERY_EXIT_AFTER");
if (exitAfter !== null) {
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, Number(exitAfter), () => {
    print("gallery: built and mapped every widget without error");
    System.exit(0);
    return GLib.SOURCE_REMOVE;
  });
}

start(Gallery, {}, {
  stylesheet: GLib.build_filenamev([GLib.get_current_dir(), "style.css"]),
});
