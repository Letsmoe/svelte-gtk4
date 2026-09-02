// Reading one StatusNotifierItem's properties. Everything the bar draws comes
// from a single GetAll: the item's own signals only say "something changed",
// never what, so a refresh is always a full read.
package main

import (
	"strings"

	"github.com/godbus/dbus/v5"
	"github.com/godbus/dbus/v5/introspect"
)

const propertiesGetAll = "org.freedesktop.DBus.Properties.GetAll"

// tooltip is the item's ToolTip property: (sa(iiay)ss) — icon name, icon
// pixmaps, title, descriptive text.
type tooltip struct {
	IconName string
	Pixmaps  []pixmap
	Title    string
	Text     string
}

func readItem(conn *dbus.Conn, item trayItem) (Item, error) {
	properties, err := allProperties(conn, item)
	if err != nil {
		return Item{}, err
	}
	status := stringProperty(properties, "Status")
	icon, iconData := resolveIcon(properties, status)
	return Item{
		Key:        item.key,
		ID:         stringProperty(properties, "Id"),
		Title:      stringProperty(properties, "Title"),
		Status:     status,
		Category:   stringProperty(properties, "Category"),
		Icon:       icon,
		IconData:   iconData,
		Tooltip:    tooltipOf(properties),
		ItemIsMenu: boolProperty(properties, "ItemIsMenu"),
		MenuPath:   pathProperty(properties, "Menu"),
	}, nil
}

// Whether the item implements Activate. It is asked once per registration:
// the answer is a property of the toolkit that built the item, not of its
// current state, and the bar needs it to decide what a left click does.
func implementsActivate(conn *dbus.Conn, owner string, path dbus.ObjectPath) bool {
	node, err := introspect.Call(conn.Object(owner, path))
	if err != nil {
		return false
	}
	for _, iface := range node.Interfaces {
		if iface.Name == itemIface {
			return declaresActivate(iface)
		}
	}
	return false
}

func declaresActivate(iface introspect.Interface) bool {
	for _, method := range iface.Methods {
		if method.Name == "Activate" {
			return true
		}
	}
	return false
}

func allProperties(conn *dbus.Conn, item trayItem) (map[string]dbus.Variant, error) {
	var properties map[string]dbus.Variant
	call := conn.Object(item.owner, item.path).Call(propertiesGetAll, 0, itemIface)
	if call.Err != nil {
		return nil, call.Err
	}
	if err := call.Store(&properties); err != nil {
		return nil, err
	}
	return properties, nil
}

// The spec's tooltip carries a bold title and a body; the bar has one line, so
// the two are joined and the item's own Title is not repeated.
func tooltipOf(properties map[string]dbus.Variant) string {
	variant, exists := properties["ToolTip"]
	if !exists {
		return ""
	}
	var value tooltip
	if variant.Store(&value) != nil {
		return ""
	}
	return strings.TrimSpace(strings.TrimSpace(value.Title) + " " + strings.TrimSpace(value.Text))
}

func stringProperty(properties map[string]dbus.Variant, name string) string {
	variant, exists := properties[name]
	if !exists {
		return ""
	}
	var value string
	if variant.Store(&value) != nil {
		return ""
	}
	return value
}

func boolProperty(properties map[string]dbus.Variant, name string) bool {
	variant, exists := properties[name]
	if !exists {
		return false
	}
	var value bool
	if variant.Store(&value) != nil {
		return false
	}
	return value
}

func pathProperty(properties map[string]dbus.Variant, name string) string {
	variant, exists := properties[name]
	if !exists {
		return ""
	}
	var value dbus.ObjectPath
	if variant.Store(&value) != nil {
		return ""
	}
	return string(value)
}
