// Shared surface style for shell popovers/panels, driven by appearance.background
// so the bar, dock, and dropdowns all respond to the same color settings. Panels
// can't be fully transparent (allowTransparent: false → transparent falls back to
// translucent). Call inside a $derived so it tracks config changes.
import { getConfig } from "./config.svelte.js";
import { surfaceStyle, surfaceStyleString, type BackgroundMode } from "./surface.js";

export function shellPanelStyle(): string {
  return surfaceStyleString(
    surfaceStyle({
      mode: getConfig<BackgroundMode>("appearance.background.mode", "translucent"),
      alpha: getConfig("appearance.background.alpha", 0.42),
      blur: getConfig("appearance.background.blur", 8),
      allowTransparent: false,
    }),
  );
}
