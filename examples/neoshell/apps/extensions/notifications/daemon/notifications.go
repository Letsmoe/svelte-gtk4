// Package notifications implements the freedesktop org.freedesktop.Notifications
// D-Bus service so neoshell can replace a standalone daemon (e.g. swaync). It
// receives Notify calls from applications, hands each notification to a callback
// (bridged onto the shell's WebSocket bus), and emits the spec's ActionInvoked /
// NotificationClosed signals when the frontend acts on a notification.
package main

import (
	"sync"
	"time"

	"github.com/godbus/dbus/v5"
)

const (
	objectPath = "/org/freedesktop/Notifications"
	ifaceName  = "org.freedesktop.Notifications"
)

// Close reasons from the freedesktop spec.
const (
	ReasonExpired   = 1
	ReasonDismissed = 2
	ReasonClosed    = 3
)

// Action is a button offered by a notification (key is sent back on invoke).
type Action struct {
	Key   string `json:"key"`
	Label string `json:"label"`
}

// Notification is the data handed to the frontend for display.
type Notification struct {
	ID      uint32   `json:"id"`
	AppName string   `json:"appName"`
	AppIcon string   `json:"appIcon"`
	Summary string   `json:"summary"`
	Body    string   `json:"body"`
	Actions []Action `json:"actions"`
	Urgency int      `json:"urgency"` // 0 low, 1 normal, 2 critical
	Timeout int      `json:"timeout"` // ms; -1 default, 0 never expires
}

// Event is broadcast to the frontend: an "add" carries a Notification, a "close"
// carries the id and reason. Time lets the frontend ignore stale replays.
type Event struct {
	Action       string        `json:"action"`
	Notification *Notification `json:"notification,omitempty"`
	ID           uint32        `json:"id,omitempty"`
	Reason       int           `json:"reason,omitempty"`
	Time         int64         `json:"time"`
}

// Daemon owns the D-Bus name and bridges notifications to the shell.
type Daemon struct {
	conn   *dbus.Conn
	emit   func(Event)
	mu     sync.Mutex
	lastID uint32
}

// NewDaemon connects to the session bus, claims the notifications name (taking
// over from any existing daemon), and exports the service. `emit` is called for
// every add/close so the caller can forward it onto its own bus.
func NewDaemon(emit func(Event)) (*Daemon, error) {
	conn, err := dbus.SessionBus()
	if err != nil {
		return nil, err
	}
	daemon := &Daemon{conn: conn, emit: emit}

	if err := conn.Export(&service{daemon}, objectPath, ifaceName); err != nil {
		return nil, err
	}
	reply, err := conn.RequestName(ifaceName,
		dbus.NameFlagReplaceExisting|dbus.NameFlagAllowReplacement)
	if err != nil {
		return nil, err
	}
	if reply != dbus.RequestNameReplyPrimaryOwner {
		return daemon, errNameTaken
	}
	return daemon, nil
}

// InvokeAction fires the spec's ActionInvoked signal then closes the notification
// (most senders dismiss on action), so the originating app reacts.
func (d *Daemon) InvokeAction(id uint32, key string) {
	d.conn.Emit(objectPath, ifaceName+".ActionInvoked", id, key)
	d.Close(id, ReasonDismissed)
}

// Close fires NotificationClosed so the originating app knows the notification is gone.
func (d *Daemon) Close(id uint32, reason int) {
	if reason == 0 {
		reason = ReasonDismissed
	}
	d.conn.Emit(objectPath, ifaceName+".NotificationClosed", id, uint32(reason))
}

// Post raises a notification that originated inside the shell rather than on
// the bus. It shares notify's id counter so a shell-raised notification can be
// dismissed and actioned exactly like an application's.
func (d *Daemon) Post(n Notification) uint32 {
	n.ID = 0
	return d.notify(n)
}

func (d *Daemon) notify(n Notification) uint32 {
	d.mu.Lock()
	if n.ID == 0 {
		d.lastID++
		n.ID = d.lastID
	} else if n.ID > d.lastID {
		d.lastID = n.ID
	}
	d.mu.Unlock()

	d.emit(Event{Action: "add", Notification: &n, Time: time.Now().UnixMilli()})
	return n.ID
}

func (d *Daemon) closed(id uint32, reason int) {
	d.emit(Event{Action: "close", ID: id, Reason: reason, Time: time.Now().UnixMilli()})
}

// service holds only the four D-Bus methods so Export doesn't expose the Daemon's
// helper methods on the bus.
type service struct {
	d *Daemon
}

// Notify matches the spec signature `susssasa{sv}i` -> u.
func (s *service) Notify(appName string, replacesID uint32, appIcon, summary, body string,
	actions []string, hints map[string]dbus.Variant, expireTimeout int32) (uint32, *dbus.Error) {
	n := Notification{
		ID:      replacesID,
		AppName: appName,
		AppIcon: appIcon,
		Summary: summary,
		Body:    body,
		Actions: pairActions(actions),
		Urgency: urgencyFromHints(hints),
		Timeout: int(expireTimeout),
	}
	if n.AppIcon == "" {
		n.AppIcon = imagePathFromHints(hints)
	}
	return s.d.notify(n), nil
}

func (s *service) CloseNotification(id uint32) *dbus.Error {
	s.d.closed(id, ReasonClosed)
	s.d.Close(id, ReasonClosed)
	return nil
}

func (s *service) GetCapabilities() ([]string, *dbus.Error) {
	return []string{"actions", "body", "body-markup", "icon-static", "persistence"}, nil
}

func (s *service) GetServerInformation() (string, string, string, string, *dbus.Error) {
	return "neoshell", "neoworks", "1.0", "1.2", nil
}

// pairActions turns the flat [key, label, key, label, …] array into structs.
func pairActions(flat []string) []Action {
	actions := make([]Action, 0, len(flat)/2)
	for i := 0; i+1 < len(flat); i += 2 {
		actions = append(actions, Action{Key: flat[i], Label: flat[i+1]})
	}
	return actions
}

func urgencyFromHints(hints map[string]dbus.Variant) int {
	value, ok := hints["urgency"]
	if !ok {
		return 1
	}
	if level, ok := value.Value().(uint8); ok {
		return int(level)
	}
	return 1
}

func imagePathFromHints(hints map[string]dbus.Variant) string {
	for _, key := range []string{"image-path", "image_path"} {
		if value, ok := hints[key]; ok {
			if path, ok := value.Value().(string); ok {
				return path
			}
		}
	}
	return ""
}

// errNameTaken signals another daemon still owns the name (it refused replacement).
var errNameTaken = dbusError("notifications: name org.freedesktop.Notifications already owned")

type dbusError string

func (e dbusError) Error() string { return string(e) }
