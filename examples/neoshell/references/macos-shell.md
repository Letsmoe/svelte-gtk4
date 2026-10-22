# macOS desktop shell: reference for a GTK4 layer-shell rebuild

Scope: macOS 26 Tahoe (Liquid Glass) first, Sequoia 15 differences noted where found.

Confidence legend: **[doc]** documented by Apple or a cited primary source; **[rev]** from a press review or secondary blog; **[est]** estimate or community figure, not verified; **[gap]** no reliable figure found.

Source note: the Apple HIG pages for Menu bar, Dock, Spotlight, Notifications and Motion returned only page titles (JS-rendered) or 404 on fetch, so Apple HIG wording is not quoted here. Figures marked [est] should be measured on a real Mac (`defaults read com.apple.dock`, Accessibility Inspector, or screen recording at 120 fps) before being treated as spec.

---

## 1. Menu bar

- **Layout, left to right** [doc, general HIG order]: Apple menu, bold app-name menu, File, Edit, Format, View, app menus, Window, Help. Right side: status items (menu bar extras), Control Center icon, clock/date, Spotlight icon, Siri (where present), with Control Center modules that are set to "Show in Menu Bar".
  - Sources: https://developer.apple.com/design/human-interface-guidelines/the-menu-bar (HIG wording not retrieved; order is consistent with the page's known structure).
- **Height** [est]: about 24 pt on non-notch displays (22 pt pre-Big Sur). Notched MacBooks use a taller bar matching the notch height, about 37 to 38 pt [est]. Query at runtime: `NSStatusBar.system.thickness` (AppKit).
- **Typography** [est]: system font at menu-bar size, about 13 to 14 pt, app name in bold. Use `NSFont.menuBarFont(ofSize:)`.
- **Status item glyphs** [est]: about 16 to 18 pt glyph, template images (SF Symbols), max about 22 pt tall. Template images adapt to light/dark and the translucent bar.
- **Translucency, Tahoe** [rev]: default is fully transparent with no backing, a faint drop shadow, and text that switches black or white based on the wallpaper. Restore the old translucent strip with System Settings > Menu Bar > "Show menu bar background".
  - https://www.macrumors.com/2025/08/01/macos-tahoe-review/
  - https://sixcolors.com/post/2025/09/macos-26-tahoe-review-power-under-glass/
  - https://dynamicmenubar.com/blog/transparent-menu-bar-macos-tahoe/
- **Translucency, Sequoia 15** [est, unverified here]: a blurred, translucent strip without Liquid Glass, which is roughly the look the Tahoe toggle restores. [gap] No source retrieved.
- **Readability complaints** [rev]: clock and battery icons vanish over busy wallpapers. Reduce Transparency (Accessibility > Display) makes the bar opaque.
  - https://nexasphere.io/blog/how-to-fix-macos-tahoe-menu-bar
- **Full-screen behaviour** [doc, general]: the bar hides in full-screen apps and is revealed by moving the pointer to the top edge. Auto-hide options in Tahoe: Always, On Desktop Only, In Full Screen Only, Never [rev].
  - https://favtray.com/blog/macos-menu-bar-customization-guide
- **Reveal delay and slide timing** [gap]: no reliable figure found. [est] reveal is a quick slide of about 0.2 to 0.3 s after the pointer touches the top edge, with a short dwell before hiding again. Measure before replicating.
- **Notch** [doc, general + rev]: menu titles and status items do not render behind the camera housing. When space runs out, extras are hidden entirely (not drawn, so not clickable). Tahoe has no overflow chevron [rev, conflicting]; a macOS 27 overflow "»" button is reported by one blog, but Badgeify says Tahoe lacks it. Third-party managers (Bartender 7, Lounge, Hidden Bar) reveal hidden items on hover, click or hotkey.
  - https://github.com/junior-rj/menubar-hide
  - https://www.macbartender.com/
  - https://badgeify.app/how-to-fix-mac-menu-bar-icons-disappearing-behind-notch/
- **Status-item menus** [doc, general]: click to open; menu stays open until an item is chosen, a click elsewhere, or Esc. Press-drag-release also works. Hover over a neighbouring extra while a menu is open switches to it [est, familiar behaviour].
- **Hover and click states** [est]: highlighted row uses the system accent fill with white text. Disabled items are dimmed, not removed (HIG guidance).
- **Keyboard** [doc, general]: Control-F2 (or Fn-Control-F2) moves focus into the menu bar. Arrow keys move between menus and items, Return selects, Esc closes, typing a letter jumps to a matching item. Help menu search finds any command.

## 2. Dock

- **Tile size** [doc via MDM and guide]: the Size slider maps to `tilesize`, valid range 16 to 128 pt [rev]. `largesize` is the magnified size. Default values [est]: tilesize about 48 to 64, largesize about 128 when magnification is on.
  - https://gist.github.com/rvanmazijk/b64a54d04afc030fe8f0989ad797fc04
  - https://support.apple.com/en-gb/guide/mdm/mdmef1fdf19/web
- **Magnification curve** [gap]: no Apple figure for the falloff. [est] the icon scale is a smooth bell-shaped function of pointer distance (roughly cosine or gaussian), with the neighbours of the hovered tile scaled by a smaller factor. Scale rises to `largesize / tilesize`, so about 2x at the defaults [est]. Icons near the pointer reflow the others, and the Dock width grows with the sum of tile widths.
- **Bounce on launch and attention** [gap]: no duration found. [est] the launch bounce is a short vertical hop, about 0.5 to 1 s total, repeated while the app is launching. Attention requests bounce the tile until the app is activated. Reduce Motion stops the bounce and leaves the dot indicator.
- **Running indicators** [est]: a small dot (about 4 to 5 pt diameter) under each running app, centred on the tile, with a neutral colour that adapts to the Dock's material.
- **Separator and recents** [doc, general]: a thin vertical rule separates apps from files, folders and Downloads/Recents-type items. Recent apps are an opt-in section (Desktop & Dock > "Show suggested and recent apps in Dock") that appears right of the separator, and running apps that are not pinned appear here too.
- **Minimize effect** [doc via defaults]: `com.apple.dock mineffect` is `genie` (default) or `scale`. A hidden `suck` value exists. Holding Shift during a minimize slows the animation. Setting: `defaults write com.apple.dock mineffect -string "scale" && killall Dock`.
  - https://macos-defaults.com/dock/mineffect.html
  - Genie duration [est]: about 0.4 to 0.6 s. Scale is a shorter zoom into the tile, about 0.25 to 0.35 s [est].
- **Auto-hide** [est]: slide out and in along the Dock edge. Show delay is effectively zero on pointer contact with the edge; hide delay is about 0.5 s [est]. Animation about 0.2 to 0.3 s with an ease-out curve [est]. [gap] No documented figures; `autohide-delay` and `autohide-time-modifier` are the defaults keys if measuring defaults.
- **Drag to reorder** [doc, general]: drag a tile; neighbours slide to open a gap. Dragging a tile out of the Dock lifts it and shows a poof when released off-Dock.
- **Drag off to remove, "poof"** [doc, general]: releasing outside the Dock removes the tile with a smoke puff animation (a short sprite-style sequence, about 0.3 to 0.5 s [est]).
- **Right-click menu** [doc, general]: Options submenu (Keep in Dock, Open at Login, Show in Finder, Show All Windows, Hide, Quit), app windows list for running apps. Files and folders: Stack options.
- **Stacks** [doc]: Dock folders show as a stack in three display styles, Fan, Grid, and List, with sort by name, date added, modified, created, kind. Sort and display options are in the stack's right-click menu.
  - Desktop stacks are separate (View > Use Stacks, Ctrl-Cmd-0), grouping by kind, date or tags: https://support.apple.com/guide/mac-help/organize-files-on-your-desktop-mh35846/mac
- **Position** [doc]: Left, Bottom, Right (Desktop & Dock). Vertical Dock lays tiles in a column; magnification keeps working on the cross axis.
- **Tahoe changes** [rev]: the Dock's behaviour did not change; Liquid Glass applies to the Dock's background material and the Dock settings still live under Desktop & Dock.
  - https://dockgroups.com/guides/macos-tahoe-dock/
- **Known rendering issue** [rev]: Apple Community reports pixelated or grey icons at small sizes on 26.1 (tilesize 24, largesize 26), user-reported only.
  - https://discussions.apple.com/thread/256182432

## 3. Spotlight

- **Invocation** [rev]: Command-Space (default), or the menu bar magnifying glass icon. Command-4 in the window opens the clipboard view once enabled.
- **Window size and position** [est]: centred horizontally in the upper third of the screen, width about 700 to 760 pt, search field about 56 to 60 pt tall, result rows about 40 pt each [est]. [gap] No Apple spec. Tahoe's Spotlight is taller and uses Liquid Glass.
- **Search field** [est]: large text (about 22 pt), placeholder "Spotlight Search", magnifier glyph on the left.
- **Result categories and order** [rev]: Top Hit, then Applications, Files, Actions, Clipboard, plus Web and Dictionary when relevant. Tahoe splits results into browsable views for apps, files, actions and clipboard, and typed filters narrow each view.
  - https://www.macstories.net/news/macos-tahoe-the-macstories-overview/
- **Keyboard navigation** [est]: Up and Down arrows move the selection, Return opens, Command-Return reveals in Finder, Tab or Right arrow goes to the preview, Esc dismisses. Command-number shortcuts for quick keys in Tahoe.
- **Preview pane** [rev]: right-hand pane for files and apps. Quick Look-style content for documents.
- **Appear and dismiss animation** [est]: fade with a slight scale (about 0.95 to 1.0) over about 0.2 s, dismiss is a fade. [gap] No figure.
- **Quick actions (Tahoe)** [rev]: Spotlight searches the frontmost app's menu bar items and runs them without reaching for the top bar. "Quick keys" run frequent actions directly. Multi-parameter queries resemble Raycast's.
  - https://www.macstories.net/news/macos-tahoe-the-macstories-overview/
  - https://appleinsider.com/articles/25/09/15/macos-tahoe-with-liquid-glass-clipboard-history-and-more-is-now-available
- **Clipboard history (Tahoe 26)** [rev]: enabled in System Settings > Spotlight; newest first; typed filter matches the start of an item only (one reviewer). Retention options added in 26.1: 30 minutes, 8 hours (default), 7 days; "Clear Clipboard History" button. Password-manager concealed clips reportedly excluded [conflicting; verify].
  - https://9to5mac.com/2025/11/04/macos-tahoe-26-1-adds-new-tools-for-spotlights-clipboard-feature/
  - https://www.macrumors.com/2025/11/04/more-spotlight-clipboard-settings-macos-26-1/
- **Spotlight on Sequoia 15** [est]: no clipboard history, no actions, no filters; results are a single list with categories and a preview pane. [gap] not verified here.

## 4. Widgets

- **Desktop widgets (Sonoma and later)** [rev]: added to the desktop from the Notification Center widget gallery or by right-click on the desktop > Edit Widgets. Sizes Small, Medium, Large, plus Extra Large where the app supports it; sizes are fixed presets, not freely resizable [rev].
  - https://www.macworld.com/article/1981562/how-to-add-widgets-desktop-macos-sonoma.html
- **Dimensions** [est, widely cited but not verified here]: Small about 158x158 pt, Medium about 338x158 pt, Large about 338x354 pt, Extra Large about 708x354 pt. Corner radius about 22 pt, continuous curve [est]. Margins about 16 pt (HIG widget guidance; the cited page did not render).
  - https://developer.apple.com/design/human-interface-guidelines/widgets (title only retrieved)
- **Editing mode** [rev]: right-click a widget > Edit Widget; widgets can be rearranged in the gallery. Snapping: widgets snap to a grid of the preset size cells [est].
- **Dimming and desaturation when windows cover the desktop** [rev]: when inactive, widgets switch to monochrome or take the wallpaper's colour; System Settings > Desktop & Dock > Widgets offers Automatic, Monochrome, Full-color [rev]. Desktop widgets can be hidden entirely with a toggle.
  - https://www.intego.com/mac-security-blog/how-to-use-desktop-widgets-on-macos-sonoma/
- **Interactivity** [doc, WidgetKit]: Button and Toggle with App Intents run without opening the app (macOS 14+). Tapping elsewhere opens the app.
- **Notification Center widgets** [rev]: same widget kit and sizes as the desktop, shown in the side panel. [gap] no Tahoe figures.
- **Vibrant / accented rendering** [doc, WidgetKit]: full colour, accented, vibrant (desaturated) modes; `containerBackground` declares the background.

## 5. Control Center and Notification Center

- **Control Center** [rev]: opened from the menu bar icon; a panel of modules (Wi-Fi, Bluetooth, Focus, Display, Sound, Now Playing, etc.). In Tahoe the panel is Liquid Glass and modules can be rearranged, as on iOS. Per-module choices in System Settings > Control Center: Show in Menu Bar, Don't Show, Show When Active.
  - https://appleinsider.com/inside/macos-tahoe/tips/inside-control-center-on-macos-tahoe
- **Open and close** [est]: drops from the menu bar, fades and scales from the top edge over about 0.2 s, dismiss on click outside, Esc.
- **Notification Center** [rev]: opened by clicking the clock or the two-finger swipe from the trackpad's right edge. Widgets and grouped notifications are in the panel; Tahoe's panel uses Liquid Glass.
- **Notification banners** [rev]: top-right corner under the menu bar, stacked; default visible time about 5 s before auto-dismiss (banners); alerts persist until dismissed. Terminal `defaults write com.apple.notificationcenterui bannerTime` (seconds) is reported to work on older releases only [rev, unverified on Tahoe].
  - https://www.addictivetips.com/mac-os/change-banner-notification-dismiss-time-on-macos/
- **Stacking and grouping** [doc, general]: notifications group per app by default; `threadIdentifier` groups by conversation (developer API).
- **Swipe to dismiss** [rev]: swipe right to clear a banner; swipe over a group clears the group.
- **Accessibility** [rev]: Reduce Transparency (System Settings > Accessibility > Display) makes menus, menu bar, sidebars and Control Center more solid. Banners are not named in any source, so treat as unconfirmed.
  - https://www.macworld.com/article/2858361/how-to-reduce-the-liquid-glass-transparency-effect-in-macos-tahoe.html

## 6. Interaction and animation principles

- **Springs** [est]: SwiftUI named springs (WWDC 2023 spring API): `.smooth` (no bounce), `.snappy` (small bounce), `.bouncy` (visible bounce); default duration about 0.5 s, bounce 0. Legacy form `response` about 0.55 s and `dampingFraction` about 0.825 [est]. Apple's Motion HIG page did not render; no official stiffness/damping numbers were retrieved.
  - https://developer.apple.com/design/human-interface-guidelines/motion (title only)
- **Hover feedback** [est]: buttons brighten or show a rounded-rect highlight about 4 to 6 pt inset, about 0.15 s fade. Dock tiles scale (see section 2).
- **Liquid Glass material** [doc, Apple newsroom via secondary sources]: "reflects and refracts its surroundings", "real-time rendering", specular highlights that shift with pointer and window movement, colour "informed by surrounding content" and adapting between light and dark.
  - https://www.apple.com/newsroom/2025/06/apple-introduced-a-delightful-and-elegant-new-software-design/ (slug as returned by search: https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/)
  - Icon Composer layers carry specular highlight, refraction, blur and shadow properties [rev].
  - Glass cannot sample other glass; overlapping glass is grouped into one container (SwiftUI `GlassEffectContainer`) [rev, developer guidance].
  - Clear vs Tinted variants: Tinted is Appearance > Liquid Glass in 26.1+, adds opacity and contrast [rev].
- **Reduced motion** [doc, general]: Reduce Motion replaces zooms, slides and bouncy springs with fades or no animation, keeps feedback. Dock bounce and Genie are the main casualties [est].
- **Reduced transparency** [rev]: opaque backgrounds for menus, menu bar, sidebars, Control Center; Increase Contrast requires Reduce Transparency on.
- **Desktop behaviour** [doc + est]: icon grid (Finder), stacks (section 2 and desktop stacks), click-to-reveal desktop: a click on the wallpaper with windows open moves them aside, a Sonoma-era behaviour [est; the Sonoma-specific steps were not verified].
- **Mission Control** [est]: top-edge swipe or F3/Mission Control gesture; windows scale to thumbnails in a grid with spaces across the top; animation about 0.3 to 0.4 s [est].
- **Stage Manager** [est]: windows shrink to a strip of thumbnails on the left; click to bring a group forward; optional on Mac.

## Hardest parts to replicate

- **Real-time background blur and refraction of the desktop under a layer surface.** Liquid Glass samples whatever is behind it at high rate and refracts it. On Hyprland a layer window can request blur (`layerrule` / Lua), which gives frosted glass but not refraction or specular lighting. Refraction needs a fragment shader that reads the background texture each frame, and GTK4 only reaches that through GSK custom shaders (`GskGLShader`), which are not a clean path for arbitrary content.
- **Specular highlights that track pointer and motion.** Needs a shader with a light position and per-frame updates tied to pointer state, combined with the blur pass. Costly on every frame; the repo's `glide.ts` approach (tick callbacks) works for layout but not for shading.
- **Genie-style mesh warp.** The minimize effect bends a window snapshot along a path into the Dock tile. Needs a textured mesh with per-vertex warp, driven by a time curve, drawn from a snapshot of the window. GTK4 has no snapshot-to-mesh API for another client's window; you would have to capture the surface or approximate with a scale plus clip.
- **Dock magnification physics.** Neighbour tiles scale and shift as a function of pointer distance, every frame, with the Dock's own width changing. Layout-driven (margins/size requests) per frame is expensive and the layer surface must resize its exclusive zone or input region on each change (see the "input region lands one commit late" gotcha in the root `CLAUDE.md`).
- **Auto-hide with click-through.** The Dock's hidden state must keep a thin edge strip for the pointer, and the surface needs an input region that matches the hidden or shown state, applied one commit late.
- **Poof and bounce sprite animations.** Need frame sequences or custom drawing; achievable with `Gtk.Picture` frames or cairo, but timing matches are approximations.
- **Full-screen detection and menu bar reveal.** Layer shell exclusive zones do not auto-hide on full-screen apps; you must watch Hyprland's `hasfullscreen` state (the repo already does this for pauseOnFullscreen) and move the exclusive zone accordingly.
- **Notch-aware hidden status items.** On Macs with a notch, items are truly hidden by the system. On Linux there is no notch unless you model one, so this behaviour is a design choice, not a replica.
- **Spring physics with matching feel.** The system uses springs with bounce; you can implement a damped spring per property (response and damping values from the table above, labelled as estimates), but matching feel needs side-by-side measurement.

## Gaps to close with measurement

- Dock magnification falloff, bounce duration, auto-hide delay and slide time.
- Menu bar full-screen reveal delay.
- Spotlight window dimensions and animation.
- Notification banner timing on Tahoe (bannerTime may not work).
- Sequoia 15 menu bar and Control Center specifics.
- Apple HIG pages (menu bar, Dock, Spotlight, notifications, motion, widgets) should be re-fetched in a browser for exact wording; the fetch returned titles only.
