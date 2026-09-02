// Coordinates the bar's click-dismissable popovers (control center, sound,
// battery). The bar is a click-through layer surface, so clicks on the desktop
// or other windows never reach it — a full-screen scrim is needed to catch an
// outside click. This tracks the single open popover so the bar can show that
// scrim and dismiss on click, and so opening one popover closes any other.
let current: (() => void) | null = null;

export const popoverState = $state({ open: false });

// registerPopover marks `close` as the active popover, closing any other first.
export function registerPopover(close: () => void) {
  if (current && current !== close) {
    current();
  }
  current = close;
  popoverState.open = true;
}

// unregisterPopover clears the active popover if `close` still owns it.
export function unregisterPopover(close: () => void) {
  if (current === close) {
    current = null;
    popoverState.open = false;
  }
}

// dismissPopover closes the active popover (called by the scrim's click).
export function dismissPopover() {
  const close = current;
  current = null;
  popoverState.open = false;
  if (close) {
    close();
  }
}
