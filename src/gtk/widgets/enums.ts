// Every GTK enum an attribute can spell, in the lowercase-and-hyphens form
// markup uses. Kept together so the same word never means two things.

import Gtk from "gi://Gtk?version=4.0";
import Pango from "gi://Pango";

export const BASELINE: Record<string, Gtk.BaselinePosition> = {
  top: Gtk.BaselinePosition.TOP,
  center: Gtk.BaselinePosition.CENTER,
  bottom: Gtk.BaselinePosition.BOTTOM,
};

export const POLICY: Record<string, Gtk.PolicyType> = {
  always: Gtk.PolicyType.ALWAYS,
  automatic: Gtk.PolicyType.AUTOMATIC,
  never: Gtk.PolicyType.NEVER,
  external: Gtk.PolicyType.EXTERNAL,
};

export const SELECTION: Record<string, Gtk.SelectionMode> = {
  none: Gtk.SelectionMode.NONE,
  single: Gtk.SelectionMode.SINGLE,
  browse: Gtk.SelectionMode.BROWSE,
  multiple: Gtk.SelectionMode.MULTIPLE,
};

export const POSITION: Record<string, Gtk.PositionType> = {
  left: Gtk.PositionType.LEFT,
  right: Gtk.PositionType.RIGHT,
  top: Gtk.PositionType.TOP,
  bottom: Gtk.PositionType.BOTTOM,
};

export const PACK: Record<string, Gtk.PackType> = {
  start: Gtk.PackType.START,
  end: Gtk.PackType.END,
};

export const ARROW: Record<string, Gtk.ArrowType> = {
  up: Gtk.ArrowType.UP,
  down: Gtk.ArrowType.DOWN,
  left: Gtk.ArrowType.LEFT,
  right: Gtk.ArrowType.RIGHT,
  none: Gtk.ArrowType.NONE,
};

export const JUSTIFY: Record<string, Gtk.Justification> = {
  left: Gtk.Justification.LEFT,
  right: Gtk.Justification.RIGHT,
  center: Gtk.Justification.CENTER,
  fill: Gtk.Justification.FILL,
};

export const CONTENT_FIT: Record<string, Gtk.ContentFit> = {
  fill: Gtk.ContentFit.FILL,
  contain: Gtk.ContentFit.CONTAIN,
  cover: Gtk.ContentFit.COVER,
  "scale-down": Gtk.ContentFit.SCALE_DOWN,
};

export const ICON_SIZE: Record<string, Gtk.IconSize> = {
  inherit: Gtk.IconSize.INHERIT,
  normal: Gtk.IconSize.NORMAL,
  large: Gtk.IconSize.LARGE,
};

export const LEVEL_MODE: Record<string, Gtk.LevelBarMode> = {
  continuous: Gtk.LevelBarMode.CONTINUOUS,
  discrete: Gtk.LevelBarMode.DISCRETE,
};

export const INSCRIPTION_OVERFLOW: Record<string, Gtk.InscriptionOverflow> = {
  clip: Gtk.InscriptionOverflow.CLIP,
  start: Gtk.InscriptionOverflow.ELLIPSIZE_START,
  middle: Gtk.InscriptionOverflow.ELLIPSIZE_MIDDLE,
  end: Gtk.InscriptionOverflow.ELLIPSIZE_END,
};

// GTK's own wrap mode, used by text views. Labels wrap with Pango's.
export const TEXT_WRAP: Record<string, Gtk.WrapMode> = {
  none: Gtk.WrapMode.NONE,
  char: Gtk.WrapMode.CHAR,
  word: Gtk.WrapMode.WORD,
  "word-char": Gtk.WrapMode.WORD_CHAR,
};

export const REVEALER_TRANSITION: Record<
  string,
  Gtk.RevealerTransitionType
> = {
  none: Gtk.RevealerTransitionType.NONE,
  crossfade: Gtk.RevealerTransitionType.CROSSFADE,
  "slide-right": Gtk.RevealerTransitionType.SLIDE_RIGHT,
  "slide-left": Gtk.RevealerTransitionType.SLIDE_LEFT,
  "slide-up": Gtk.RevealerTransitionType.SLIDE_UP,
  "slide-down": Gtk.RevealerTransitionType.SLIDE_DOWN,
  "swing-right": Gtk.RevealerTransitionType.SWING_RIGHT,
  "swing-left": Gtk.RevealerTransitionType.SWING_LEFT,
  "swing-up": Gtk.RevealerTransitionType.SWING_UP,
  "swing-down": Gtk.RevealerTransitionType.SWING_DOWN,
};

export const STACK_TRANSITION: Record<string, Gtk.StackTransitionType> = {
  none: Gtk.StackTransitionType.NONE,
  crossfade: Gtk.StackTransitionType.CROSSFADE,
  "slide-right": Gtk.StackTransitionType.SLIDE_RIGHT,
  "slide-left": Gtk.StackTransitionType.SLIDE_LEFT,
  "slide-up": Gtk.StackTransitionType.SLIDE_UP,
  "slide-down": Gtk.StackTransitionType.SLIDE_DOWN,
  "slide-left-right": Gtk.StackTransitionType.SLIDE_LEFT_RIGHT,
  "slide-up-down": Gtk.StackTransitionType.SLIDE_UP_DOWN,
  "over-up": Gtk.StackTransitionType.OVER_UP,
  "over-down": Gtk.StackTransitionType.OVER_DOWN,
  "over-left": Gtk.StackTransitionType.OVER_LEFT,
  "over-right": Gtk.StackTransitionType.OVER_RIGHT,
  "under-up": Gtk.StackTransitionType.UNDER_UP,
  "under-down": Gtk.StackTransitionType.UNDER_DOWN,
  "under-left": Gtk.StackTransitionType.UNDER_LEFT,
  "under-right": Gtk.StackTransitionType.UNDER_RIGHT,
  "rotate-left": Gtk.StackTransitionType.ROTATE_LEFT,
  "rotate-right": Gtk.StackTransitionType.ROTATE_RIGHT,
};

export const ELLIPSIZE: Record<string, Pango.EllipsizeMode> = {
  none: Pango.EllipsizeMode.NONE,
  start: Pango.EllipsizeMode.START,
  middle: Pango.EllipsizeMode.MIDDLE,
  end: Pango.EllipsizeMode.END,
};

export const WRAP: Record<string, Pango.WrapMode> = {
  word: Pango.WrapMode.WORD,
  char: Pango.WrapMode.CHAR,
  "word-char": Pango.WrapMode.WORD_CHAR,
};
