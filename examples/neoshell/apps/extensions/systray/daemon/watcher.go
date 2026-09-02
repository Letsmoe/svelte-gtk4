// The StatusNotifierWatcher half of the tray. Owning
// org.kde.StatusNotifierWatcher is what makes applications publish tray items
// at all: a toolkit looks the name up, registers its item against it, and
// exposes the icon on its own bus name. The watcher tracks those
// registrations, reads each item's properties over D-Bus, and hands the whole
// list to its caller whenever anything changes.
package main

import (
	"fmt"
	"log"
	"os"
	"sort"
	"strings"
	"sync"

	"github.com/godbus/dbus/v5"
	"github.com/godbus/dbus/v5/introspect"
	"github.com/godbus/dbus/v5/prop"
)

const (
	watcherName     = "org.kde.StatusNotifierWatcher"
	watcherPath     = "/StatusNotifierWatcher"
	watcherIface    = "org.kde.StatusNotifierWatcher"
	itemIface       = "org.kde.StatusNotifierItem"
	itemNamePrefix  = "org.kde.StatusNotifierItem-"
	defaultItemPath = "/StatusNotifierItem"
	ownerChangeName = "org.freedesktop.DBus.NameOwnerChanged"
)

// Item is one tray icon as the shell sees it. Key is the opaque handle a
// command addresses; everything else is display state. Icon is a freedesktop
// icon name the host resolves at /appicon/<name>, IconData a ready data URL —
// exactly one of the two is set.
type Item struct {
	Key        string `json:"key"`
	ID         string `json:"id"`
	Title      string `json:"title"`
	Status     string `json:"status"`
	Category   string `json:"category"`
	Icon       string `json:"icon"`
	IconData   string `json:"iconData"`
	Tooltip    string `json:"tooltip"`
	ItemIsMenu bool   `json:"itemIsMenu"`
	MenuPath   string `json:"menuPath"`
	// Whether the item implements Activate at all. Everything built on
	// libayatana-appindicator does not: for those the menu is the only way in,
	// so the bar has to know before it decides what a left click does.
	HasActivate bool `json:"hasActivate"`
}

// trayItem is one registration. service is the name the application gave,
// owner its unique connection name — signals arrive under the unique name, and
// a vanishing owner is how an item is retracted.
type trayItem struct {
	key         string
	service     string
	owner       string
	path        dbus.ObjectPath
	activatable bool
	state       Item
}

// Watcher owns the watcher name and the item registry.
type Watcher struct {
	conn     *dbus.Conn
	props    *prop.Properties
	emit     func([]Item)
	signals  chan *dbus.Signal
	hostName string
	mu       sync.Mutex
	items    map[string]*trayItem
}

// NewWatcher connects to the session bus, claims the host and watcher names
// (taking over from a stale watcher), and starts tracking items. emit is
// called with the full list whenever it changes.
func NewWatcher(emit func([]Item)) (*Watcher, error) {
	conn, err := dbus.SessionBus()
	if err != nil {
		return nil, err
	}
	watcher := &Watcher{
		conn:    conn,
		emit:    emit,
		signals: make(chan *dbus.Signal, 64),
		items:   make(map[string]*trayItem),
	}
	if err := watcher.export(); err != nil {
		return nil, err
	}
	conn.Signal(watcher.signals)
	go watcher.listen()
	watcher.watchOwnerChanges()
	watcher.adoptRunningItems()
	watcher.publish()
	return watcher, nil
}

// Close releases both bus names so a reconnecting daemon can claim them again
// — the session connection itself is shared and outlives this watcher.
func (w *Watcher) Close() {
	w.conn.RemoveSignal(w.signals)
	_, _ = w.conn.ReleaseName(watcherName)
	_, _ = w.conn.ReleaseName(w.hostName)
	close(w.signals)
}

// Invoke calls one of the item's spec methods.
func (w *Watcher) Invoke(key string, method string, args ...interface{}) {
	item, exists := w.item(key)
	if !exists {
		return
	}
	call := w.conn.Object(item.owner, item.path).Call(itemIface+"."+method, 0, args...)
	if call.Err != nil {
		log.Printf("trayd: %s on %s failed: %v", method, key, call.Err)
	}
}

// Menu reads the item's dbusmenu layout for the bar to draw.
func (w *Watcher) Menu(key string) ([]MenuEntry, error) {
	item, exists := w.item(key)
	if !exists {
		return nil, fmt.Errorf("no tray item %s", key)
	}
	return readMenu(w.conn, item)
}

// MenuEvent reports a click on one menu row back to the application.
func (w *Watcher) MenuEvent(key string, id int32, event string) {
	item, exists := w.item(key)
	if !exists {
		return
	}
	if err := sendMenuEvent(w.conn, item, id, event); err != nil {
		log.Printf("trayd: menu %s on %s failed: %v", event, key, err)
	}
}

func (w *Watcher) export() error {
	if err := w.claimHostName(); err != nil {
		return err
	}
	if err := w.conn.Export(&watcherService{watcher: w}, watcherPath, watcherIface); err != nil {
		return err
	}
	properties, err := prop.Export(w.conn, watcherPath, w.propertyMap())
	if err != nil {
		return err
	}
	w.props = properties
	introspection := introspect.NewIntrospectable(w.introspection())
	err = w.conn.Export(introspection, watcherPath, "org.freedesktop.DBus.Introspectable")
	if err != nil {
		return err
	}
	return w.claimWatcherName()
}

// An application checks for a registered host before it bothers exporting an
// item, so the host name is claimed before the watcher name.
func (w *Watcher) claimHostName() error {
	w.hostName = fmt.Sprintf("org.kde.StatusNotifierHost-%d", os.Getpid())
	reply, err := w.conn.RequestName(w.hostName, dbus.NameFlagDoNotQueue)
	if err != nil {
		return err
	}
	if reply != dbus.RequestNameReplyPrimaryOwner {
		return fmt.Errorf("host name %s is already owned", w.hostName)
	}
	return nil
}

func (w *Watcher) claimWatcherName() error {
	flags := dbus.NameFlagReplaceExisting | dbus.NameFlagAllowReplacement
	reply, err := w.conn.RequestName(watcherName, flags)
	if err != nil {
		return err
	}
	if reply != dbus.RequestNameReplyPrimaryOwner {
		return fmt.Errorf("%s is owned by another tray", watcherName)
	}
	return w.conn.Emit(watcherPath, watcherIface+".StatusNotifierHostRegistered")
}

func (w *Watcher) propertyMap() prop.Map {
	return prop.Map{
		watcherIface: {
			"RegisteredStatusNotifierItems": {
				Value: []string{},
				Emit:  prop.EmitTrue,
			},
			"IsStatusNotifierHostRegistered": {
				Value: true,
				Emit:  prop.EmitTrue,
			},
			"ProtocolVersion": {
				Value: int32(0),
				Emit:  prop.EmitFalse,
			},
		},
	}
}

func (w *Watcher) introspection() *introspect.Node {
	return &introspect.Node{
		Name: watcherPath,
		Interfaces: []introspect.Interface{
			introspect.IntrospectData,
			prop.IntrospectData,
			{
				Name:       watcherIface,
				Methods:    introspect.Methods(&watcherService{watcher: w}),
				Signals:    watcherSignals(),
				Properties: w.props.Introspection(watcherIface),
			},
		},
	}
}

func watcherSignals() []introspect.Signal {
	service := introspect.Arg{Name: "service", Type: "s", Direction: "out"}
	return []introspect.Signal{
		{Name: "StatusNotifierItemRegistered", Args: []introspect.Arg{service}},
		{Name: "StatusNotifierItemUnregistered", Args: []introspect.Arg{service}},
		{Name: "StatusNotifierHostRegistered"},
		{Name: "StatusNotifierHostUnregistered"},
	}
}

// watcherService is the exported object. Its method set is the interface
// applications call; the trailing dbus.Sender is filled in by godbus and does
// not appear in the D-Bus signature.
type watcherService struct {
	watcher *Watcher
}

func (s *watcherService) RegisterStatusNotifierItem(
	service string,
	sender dbus.Sender,
) *dbus.Error {
	s.watcher.register(service, string(sender))
	return nil
}

// A second host is welcome to the items; this one publishes them regardless.
func (s *watcherService) RegisterStatusNotifierHost(service string) *dbus.Error {
	return nil
}

func (w *Watcher) register(service string, sender string) {
	name, path := addressOf(service, sender)
	owner := w.ownerOf(name)
	if owner == "" {
		return
	}
	// Keyed by owner, not by the name registered: an application whose
	// well-known name was adopted at startup and which then registers itself
	// again is one item, not two.
	key := owner + string(path)
	if !w.addItem(key, name, owner, path) {
		return
	}
	w.conn.AddMatchSignal(dbus.WithMatchSender(owner), dbus.WithMatchObjectPath(path))
	_ = w.conn.Emit(watcherPath, watcherIface+".StatusNotifierItemRegistered", service)
	w.setActivatable(key, implementsActivate(w.conn, owner, path))
	w.refresh(key)
}

// The spec lets an application register either its bus name or, when the item
// sits at a non-standard object path, that path — in which case the sender is
// the bus name.
func addressOf(service string, sender string) (string, dbus.ObjectPath) {
	if strings.HasPrefix(service, "/") {
		return sender, dbus.ObjectPath(service)
	}
	return service, dbus.ObjectPath(defaultItemPath)
}

func (w *Watcher) ownerOf(name string) string {
	if strings.HasPrefix(name, ":") {
		return name
	}
	var owner string
	call := w.conn.BusObject().Call("org.freedesktop.DBus.GetNameOwner", 0, name)
	if call.Store(&owner) != nil {
		return ""
	}
	return owner
}

// Applications that registered with a watcher that has since died do not
// re-register on their own until the name changes hands, so the well-known
// item names already on the bus are adopted at startup.
func (w *Watcher) adoptRunningItems() {
	var names []string
	call := w.conn.BusObject().Call("org.freedesktop.DBus.ListNames", 0)
	if call.Store(&names) != nil {
		return
	}
	for _, name := range names {
		w.adoptIfItem(name)
	}
}

func (w *Watcher) adoptIfItem(name string) {
	if !strings.HasPrefix(name, itemNamePrefix) {
		return
	}
	w.register(name, "")
}

func (w *Watcher) watchOwnerChanges() {
	w.conn.AddMatchSignal(
		dbus.WithMatchSender("org.freedesktop.DBus"),
		dbus.WithMatchInterface("org.freedesktop.DBus"),
		dbus.WithMatchMember("NameOwnerChanged"),
	)
}

func (w *Watcher) listen() {
	for signal := range w.signals {
		w.handleSignal(signal)
	}
}

// Items announce changes either with their own NewIcon/NewStatus/… signals or
// with PropertiesChanged; both arrive from the item's object, and both mean
// the same thing here — read the properties again.
func (w *Watcher) handleSignal(signal *dbus.Signal) {
	if signal.Name == ownerChangeName {
		w.handleOwnerChange(signal)
		return
	}
	key := w.keyOf(signal.Sender, signal.Path)
	if key == "" {
		return
	}
	w.refresh(key)
}

func (w *Watcher) handleOwnerChange(signal *dbus.Signal) {
	if len(signal.Body) < 3 {
		return
	}
	name, nameOk := signal.Body[0].(string)
	newOwner, ownerOk := signal.Body[2].(string)
	if !nameOk || !ownerOk || newOwner != "" {
		return
	}
	w.removeOwnedBy(name)
}

func (w *Watcher) refresh(key string) {
	item, exists := w.item(key)
	if !exists {
		return
	}
	state, err := readItem(w.conn, item)
	if err != nil {
		w.remove(key, item.service)
		return
	}
	state.HasActivate = item.activatable
	w.setState(key, state)
	w.publish()
}

func (w *Watcher) publish() {
	items, services := w.snapshot()
	w.emit(items)
	w.props.SetMust(watcherIface, "RegisteredStatusNotifierItems", services)
}

// snapshot returns the item list in a stable order — the bar would otherwise
// reshuffle its icons on every refresh, since the registry is a map.
func (w *Watcher) snapshot() ([]Item, []string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	items := make([]Item, 0, len(w.items))
	services := make([]string, 0, len(w.items))
	for _, item := range w.items {
		items = append(items, item.state)
		services = append(services, item.service)
	}
	sort.Slice(items, func(left int, right int) bool { return items[left].Key < items[right].Key })
	sort.Strings(services)
	return items, services
}

// addItem reports whether the registration was new: an application that
// re-registers an item it already owns must not double it in the bar.
func (w *Watcher) addItem(key string, service string, owner string, path dbus.ObjectPath) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	if _, exists := w.items[key]; exists {
		return false
	}
	w.items[key] = &trayItem{
		key:     key,
		service: service,
		owner:   owner,
		path:    path,
		state:   Item{Key: key},
	}
	return true
}

// item hands out a copy: the registry is read from the D-Bus signal goroutine
// and written from the command loop, so a pointer would put the item state in
// two hands at once.
func (w *Watcher) item(key string) (trayItem, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	item, exists := w.items[key]
	if !exists {
		return trayItem{}, false
	}
	return *item, true
}

func (w *Watcher) setActivatable(key string, activatable bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	item, exists := w.items[key]
	if !exists {
		return
	}
	item.activatable = activatable
}

func (w *Watcher) setState(key string, state Item) {
	w.mu.Lock()
	defer w.mu.Unlock()
	item, exists := w.items[key]
	if !exists {
		return
	}
	item.state = state
}

func (w *Watcher) keyOf(sender string, path dbus.ObjectPath) string {
	w.mu.Lock()
	defer w.mu.Unlock()
	for key, item := range w.items {
		if item.owner == sender && item.path == path {
			return key
		}
	}
	return ""
}

func (w *Watcher) remove(key string, service string) {
	item := w.take(key)
	if item == nil {
		return
	}
	w.conn.RemoveMatchSignal(
		dbus.WithMatchSender(item.owner),
		dbus.WithMatchObjectPath(item.path),
	)
	_ = w.conn.Emit(watcherPath, watcherIface+".StatusNotifierItemUnregistered", service)
	w.publish()
}

func (w *Watcher) removeOwnedBy(name string) {
	for _, key := range w.keysOwnedBy(name) {
		w.remove(key, name)
	}
}

func (w *Watcher) keysOwnedBy(name string) []string {
	w.mu.Lock()
	defer w.mu.Unlock()
	keys := []string{}
	for key, item := range w.items {
		if item.owner == name || item.service == name {
			keys = append(keys, key)
		}
	}
	return keys
}

func (w *Watcher) take(key string) *trayItem {
	w.mu.Lock()
	defer w.mu.Unlock()
	item, exists := w.items[key]
	if !exists {
		return nil
	}
	delete(w.items, key)
	return item
}
