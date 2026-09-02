// Shared shell-surface background. The bar and every shell window derive their
// backdrop from the same appearance.background setting, mirroring macOS's menu
// bar options:
//   translucent — tint + blur     ("menu bar background on")
//   transparent — none, on the wallpaper ("off") — bar only
//   solid       — opaque          ("reduce transparency on")
//
// A surface that is not allowed to be transparent (any real window — you must be
// able to see and use it) falls back to translucent for that mode.

export type BackgroundMode = "translucent" | "solid" | "transparent";

export type SurfaceStyle = {
  backgroundImage: string;
  backgroundColor: string;
  backdropFilter: string;
};

export type SurfaceOptions = {
  mode: BackgroundMode;
  alpha: number;
  blur: number;
  // Adaptive gradient (the bar's sampled wallpaper colors). Absent → neutral tint.
  gradient?: string;
  // Real windows can't be fully transparent; the bar can.
  allowTransparent?: boolean;
};

// Neutral surface tint used when no adaptive gradient is supplied (shell windows).
const NEUTRAL_RGB = "11, 11, 13";

export function surfaceStyle(options: SurfaceOptions): SurfaceStyle {
  const empty: SurfaceStyle = {
    backgroundImage: "",
    backgroundColor: "",
    backdropFilter: "",
  };

  let mode = options.mode;
  if (mode === "transparent" && options.allowTransparent === false) {
    mode = "translucent";
  }

  if (mode === "transparent") {
    return empty;
  }

  if (mode === "solid") {
    if (options.gradient) {
      // Opaque adaptive tint: the same gradient at full opacity.
      return { ...empty, backgroundImage: opaqueGradient(options.gradient) };
    }
    return { ...empty, backgroundColor: `rgb(${NEUTRAL_RGB})` };
  }

  // translucent
  const blur = `blur(${options.blur}px) saturate(1.1)`;
  if (options.gradient) {
    return { ...empty, backgroundImage: options.gradient, backdropFilter: blur };
  }
  return {
    ...empty,
    backgroundColor: `rgba(${NEUTRAL_RGB}, ${options.alpha})`,
    backdropFilter: blur,
  };
}

// Drop per-stop alpha to 1 so a translucent gradient reads as opaque.
function opaqueGradient(gradient: string): string {
  return gradient.replace(/rgba\(([^)]+?),\s*[\d.]+\)/g, "rgb($1)");
}

// Flatten a SurfaceStyle into an inline style string.
export function surfaceStyleString(style: SurfaceStyle): string {
  const parts: string[] = [];
  if (style.backgroundImage) {
    parts.push(`background-image: ${style.backgroundImage}`);
  }
  if (style.backgroundColor) {
    parts.push(`background-color: ${style.backgroundColor}`);
  }
  if (style.backdropFilter) {
    parts.push(`backdrop-filter: ${style.backdropFilter}`);
    parts.push(`-webkit-backdrop-filter: ${style.backdropFilter}`);
  }
  return parts.join("; ");
}
