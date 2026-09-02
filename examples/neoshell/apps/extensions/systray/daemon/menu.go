// The com.canonical.dbusmenu client. A large family of tray items — anything
// built on libayatana-appindicator, which is most GTK applications — exports
// no Activate and no ContextMenu at all: the menu is the whole interaction, and
// the shell is expected to draw it. So the layout is fetched here and handed
// to the bar as plain data, and a click comes back as a menu event.
package main

import (
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/godbus/dbus/v5"
)

const menuIface = "com.canonical.dbusmenu"

// MenuEntry is one row of a menu, flattened to what the shell draws.
type MenuEntry struct {
	ID          int32       `json:"id"`
	Label       string      `json:"label"`
	Enabled     bool        `json:"enabled"`
	Separator   bool        `json:"separator"`
	ToggleType  string      `json:"toggleType"`
	ToggleState int32       `json:"toggleState"`
	Icon        string      `json:"icon"`
	IconData    string      `json:"iconData"`
	Children    []MenuEntry `json:"children"`
}

// layoutItem mirrors the (ia{sv}av) GetLayout returns. Children arrive as
// variants holding that same structure, which is why the recursion goes
// through Store rather than a typed slice.
type layoutItem struct {
	ID         int32
	Properties map[string]dbus.Variant
	Children   []dbus.Variant
}

func readMenu(conn *dbus.Conn, item trayItem) ([]MenuEntry, error) {
	if item.state.MenuPath == "" {
		return nil, fmt.Errorf("item %s exports no menu", item.key)
	}
	object := conn.Object(item.owner, dbus.ObjectPath(item.state.MenuPath))
	// Applications fill their menu lazily; AboutToShow is the spec's cue to do
	// it, and a failure only means the layout is already current.
	var needsUpdate bool
	_ = object.Call(menuIface+".AboutToShow", 0, int32(0)).Store(&needsUpdate)
	root, err := readLayout(object)
	if err != nil {
		return nil, err
	}
	return entriesOf(root.Children), nil
}

func readLayout(object dbus.BusObject) (layoutItem, error) {
	var revision uint32
	var root layoutItem
	call := object.Call(menuIface+".GetLayout", 0, int32(0), int32(-1), []string{})
	if call.Err != nil {
		return layoutItem{}, call.Err
	}
	if err := call.Store(&revision, &root); err != nil {
		return layoutItem{}, err
	}
	return root, nil
}

// A click reaches the application as an "clicked" event on the row's id; the
// application decides what that means and updates its own state.
func sendMenuEvent(conn *dbus.Conn, item trayItem, id int32, event string) error {
	if item.state.MenuPath == "" {
		return fmt.Errorf("item %s exports no menu", item.key)
	}
	object := conn.Object(item.owner, dbus.ObjectPath(item.state.MenuPath))
	timestamp := uint32(time.Now().Unix())
	data := dbus.MakeVariant(int32(0))
	return object.Call(menuIface+".Event", 0, id, event, data, timestamp).Err
}

func entriesOf(children []dbus.Variant) []MenuEntry {
	entries := []MenuEntry{}
	for _, child := range children {
		entries = appendEntry(entries, child)
	}
	return entries
}

func appendEntry(entries []MenuEntry, child dbus.Variant) []MenuEntry {
	var item layoutItem
	if child.Store(&item) != nil {
		return entries
	}
	if !boolOr(item.Properties, "visible", true) {
		return entries
	}
	return append(entries, entryOf(item))
}

func entryOf(item layoutItem) MenuEntry {
	icon, iconData := menuIcon(item.Properties)
	return MenuEntry{
		ID:          item.ID,
		Label:       menuLabel(item.Properties),
		Enabled:     boolOr(item.Properties, "enabled", true),
		Separator:   stringProperty(item.Properties, "type") == "separator",
		ToggleType:  stringProperty(item.Properties, "toggle-type"),
		ToggleState: int32Or(item.Properties, "toggle-state", -1),
		Icon:        icon,
		IconData:    iconData,
		Children:    entriesOf(item.Children),
	}
}

// Labels carry GTK mnemonics: a single underscore marks the accelerator key
// and a doubled one is a literal underscore. Nothing in the bar draws
// accelerators, so they come out as plain text.
func menuLabel(properties map[string]dbus.Variant) string {
	escaped := strings.ReplaceAll(stringProperty(properties, "label"), "__", "\x00")
	stripped := strings.ReplaceAll(escaped, "_", "")
	return strings.ReplaceAll(stripped, "\x00", "_")
}

// icon-data is a PNG already, so it only needs wrapping; icon-name goes
// through the host's icon resolver like any other themed name.
func menuIcon(properties map[string]dbus.Variant) (string, string) {
	name := stringProperty(properties, "icon-name")
	if name != "" {
		return name, ""
	}
	variant, exists := properties["icon-data"]
	if !exists {
		return "", ""
	}
	var content []byte
	if variant.Store(&content) != nil || len(content) == 0 {
		return "", ""
	}
	return "", "data:image/png;base64," + base64.StdEncoding.EncodeToString(content)
}

func boolOr(properties map[string]dbus.Variant, name string, fallback bool) bool {
	variant, exists := properties[name]
	if !exists {
		return fallback
	}
	var value bool
	if variant.Store(&value) != nil {
		return fallback
	}
	return value
}

func int32Or(properties map[string]dbus.Variant, name string, fallback int32) int32 {
	variant, exists := properties[name]
	if !exists {
		return fallback
	}
	var value int32
	if variant.Store(&value) != nil {
		return fallback
	}
	return value
}
