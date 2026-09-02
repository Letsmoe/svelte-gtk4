// The tag registry. A tag maps to a class, and the mirror builds one instance
// of it per element node.

import type { SElement } from "../../dom/nodes";
import type { Mount, MountClass } from "./base";

import { GtkActionBar } from "./actionbar";
import { GtkAspectFrame } from "./aspectframe";
import { GtkBox } from "./box";
import { GtkButton } from "./button";
import { GtkCalendar } from "./calendar";
import { GtkCenterBox } from "./centerbox";
import { GtkCheckButton } from "./checkbutton";
import { GtkColorButton } from "./colorbutton";
import { GtkDrawingArea } from "./drawingarea";
import { GtkDropDown } from "./dropdown";
import { GtkEditableLabel } from "./editablelabel";
import { GtkEntry } from "./entry";
import { GtkExpander } from "./expander";
import { GtkFixed } from "./fixed";
import { GtkFlowBox } from "./flowbox";
import { GtkFontButton } from "./fontbutton";
import { GtkFrame } from "./frame";
import { GtkGraphicsOffload } from "./graphicsoffload";
import { GtkGrid } from "./grid";
import { GtkHeaderBar } from "./headerbar";
import { GtkImage } from "./image";
import { GtkInscription } from "./inscription";
import { GtkLabel } from "./label";
import { GtkLevelBar } from "./levelbar";
import { GtkLinkButton } from "./linkbutton";
import { GtkListBox } from "./listbox";
import { GtkMenuButton } from "./menubutton";
import { GtkNotebook } from "./notebook";
import { GtkOverlay } from "./overlay";
import { GtkPaned } from "./paned";
import { GtkPasswordEntry } from "./passwordentry";
import { GtkPicture } from "./picture";
import { GtkPopover } from "./popover";
import { GtkProgressBar } from "./progressbar";
import { GtkRevealer } from "./revealer";
import { GtkScale } from "./scale";
import { GtkScaleButton } from "./scalebutton";
import { GtkScrolledWindow } from "./scrolledwindow";
import { GtkSearchBar } from "./searchbar";
import { GtkSearchEntry } from "./searchentry";
import { GtkSeparator } from "./separator";
import { GtkSpinButton } from "./spinbutton";
import { GtkSpinner } from "./spinner";
import { GtkStack } from "./stack";
import { GtkStackSidebar } from "./stacksidebar";
import { GtkStackSwitcher } from "./stackswitcher";
import { GtkSwitch } from "./switch";
import { GtkText } from "./text";
import { GtkTextView } from "./textview";
import { GtkToggleButton } from "./togglebutton";
import { GtkVideo } from "./video";
import { GtkViewport } from "./viewport";
import { GtkWindow } from "./window";
import { GtkWindowControls } from "./windowcontrols";
import { GtkWindowHandle } from "./windowhandle";
import { Root } from "./root";

export { ROOT_TAG } from "./root";
export type { Mount } from "./base";

const CLASSES: MountClass[] = [
  Root,

  GtkWindow,
  GtkHeaderBar,
  GtkActionBar,
  GtkWindowControls,
  GtkWindowHandle,
  GtkPopover,

  GtkBox,
  GtkCenterBox,
  GtkGrid,
  GtkOverlay,
  GtkPaned,
  GtkFixed,
  GtkFrame,
  GtkAspectFrame,
  GtkExpander,
  GtkRevealer,
  GtkScrolledWindow,
  GtkViewport,
  GtkStack,
  GtkStackSwitcher,
  GtkStackSidebar,
  GtkNotebook,
  GtkListBox,
  GtkFlowBox,
  GtkGraphicsOffload,

  GtkLabel,
  GtkInscription,
  GtkImage,
  GtkPicture,
  GtkSpinner,
  GtkProgressBar,
  GtkLevelBar,
  GtkSeparator,
  GtkCalendar,
  GtkDrawingArea,
  GtkVideo,

  GtkButton,
  GtkToggleButton,
  GtkCheckButton,
  GtkLinkButton,
  GtkMenuButton,
  GtkSwitch,
  GtkScale,
  GtkSpinButton,
  GtkScaleButton,
  GtkColorButton,
  GtkFontButton,

  GtkEntry,
  GtkText,
  GtkSearchEntry,
  GtkPasswordEntry,
  GtkEditableLabel,
  GtkTextView,
  GtkSearchBar,
  GtkDropDown,
];

const TAGS = new Map<string, MountClass>(
  CLASSES.map((widget) => [widget.tag, widget]),
);

// Older spellings, and one that says what it is for rather than what it is: a
// `gtkpressable` is a box, but events.ts is what makes it worth naming.
TAGS.set("gtkicon", GtkImage);
TAGS.set("gtkpressable", GtkBox);

export function mountFor(node: SElement): Mount | null {
  const widget = TAGS.get(node.tagName);
  if (widget === undefined) {
    return null;
  }
  return new widget(node);
}

export function isKnownTag(tagName: string): boolean {
  return TAGS.has(tagName);
}
