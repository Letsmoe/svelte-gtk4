// neoshell-trayd owns org.kde.StatusNotifierWatcher on the session D-Bus and
// bridges the tray items registered against it to the neoshell host bus over
// the unix socket wire protocol. It is the daemon half of the systray
// extension — spawned and supervised by the extension's in-process backend,
// killed when the extension unloads.
//
//	systray.items                              retained item list for the UI
//	systray:activate  {key, x, y}              left click
//	systray:secondary {key, x, y}              middle click
//	systray:context   {key, x, y}              right click; the item draws it
//	systray:scroll    {key, delta, orientation}
//	systray:menu      {key} → {entries} | {error}   the item's dbusmenu layout
//	systray:menuevent {key, id}                a click on one menu row
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"time"
)

// wireMessage is one NDJSON line on the host socket. A retained publish is
// dropped by the host when this connection closes, so the item list never
// outlives the daemon.
type wireMessage struct {
	Type      string          `json:"type,omitempty"`
	Data      json.RawMessage `json:"data,omitempty"`
	Retain    bool            `json:"retain,omitempty"`
	Subscribe []string        `json:"subscribe,omitempty"`
}

// command is one bus message addressed at a tray item. ReplyTo is set on the
// request/reply topics; publishing there is what answers the caller.
type command struct {
	Type string `json:"type"`
	Data struct {
		Key         string `json:"key"`
		ID          int32  `json:"id"`
		X           int32  `json:"x"`
		Y           int32  `json:"y"`
		Delta       int32  `json:"delta"`
		Orientation string `json:"orientation"`
	} `json:"data"`
	ReplyTo string `json:"replyTo"`
}

type publisher func(message wireMessage)

func main() {
	socketPath := flag.String("socket", defaultSocketPath(), "neoshell host bus socket")
	flag.Parse()

	for {
		if err := run(*socketPath); err != nil {
			log.Printf("trayd: %v; retrying", err)
		}
		time.Sleep(2 * time.Second)
	}
}

func run(socketPath string) error {
	conn, err := net.Dial("unix", socketPath)
	if err != nil {
		return fmt.Errorf("dial host bus: %w", err)
	}
	defer conn.Close()

	writeLine := publisher(func(message wireMessage) {
		raw, err := json.Marshal(message)
		if err != nil {
			return
		}
		_, _ = conn.Write(append(raw, '\n'))
	})

	watcher, err := NewWatcher(func(items []Item) {
		data, err := json.Marshal(items)
		if err != nil {
			return
		}
		writeLine(wireMessage{Type: "systray.items", Data: data, Retain: true})
	})
	if err != nil {
		return fmt.Errorf("claim watcher name: %w", err)
	}
	defer watcher.Close()

	writeLine(wireMessage{Subscribe: []string{
		"systray:activate",
		"systray:secondary",
		"systray:context",
		"systray:scroll",
		"systray:menu",
		"systray:menuevent",
	}})
	log.Printf("trayd: bridging org.kde.StatusNotifierWatcher to %s", socketPath)

	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		handleCommand(watcher, writeLine, scanner.Bytes())
	}
	return fmt.Errorf("host bus connection closed")
}

// handleCommand dispatches one bus message to the tray item it names. Every
// dispatch runs on its own goroutine: a D-Bus call waits for the application
// to answer, and an unresponsive tray icon must not stall the read loop.
func handleCommand(watcher *Watcher, writeLine publisher, raw []byte) {
	var message command
	if err := json.Unmarshal(raw, &message); err != nil {
		return
	}
	if message.Type == "systray:menu" {
		go replyWithMenu(watcher, writeLine, message)
		return
	}
	go invoke(watcher, message)
}

// The coordinates are where the pointer was: an item that draws its own menu
// positions it against them.
func invoke(watcher *Watcher, message command) {
	data := message.Data
	switch message.Type {
	case "systray:activate":
		watcher.Invoke(data.Key, "Activate", data.X, data.Y)
	case "systray:secondary":
		watcher.Invoke(data.Key, "SecondaryActivate", data.X, data.Y)
	case "systray:context":
		watcher.Invoke(data.Key, "ContextMenu", data.X, data.Y)
	case "systray:scroll":
		watcher.Invoke(data.Key, "Scroll", data.Delta, data.Orientation)
	case "systray:menuevent":
		watcher.MenuEvent(data.Key, data.ID, "clicked")
	}
}

func replyWithMenu(watcher *Watcher, writeLine publisher, message command) {
	if message.ReplyTo == "" {
		return
	}
	entries, err := watcher.Menu(message.Data.Key)
	if err != nil {
		writeLine(wireMessage{Type: message.ReplyTo, Data: errorPayload(err)})
		return
	}
	data, err := json.Marshal(map[string][]MenuEntry{"entries": entries})
	if err != nil {
		writeLine(wireMessage{Type: message.ReplyTo, Data: errorPayload(err)})
		return
	}
	writeLine(wireMessage{Type: message.ReplyTo, Data: data})
}

func errorPayload(err error) json.RawMessage {
	data, marshalErr := json.Marshal(map[string]string{"error": err.Error()})
	if marshalErr != nil {
		return json.RawMessage(`{"error":"menu unavailable"}`)
	}
	return data
}

func defaultSocketPath() string {
	runtime := os.Getenv("XDG_RUNTIME_DIR")
	if runtime == "" {
		runtime = fmt.Sprintf("/run/user/%d", os.Getuid())
	}
	return runtime + "/neoshell-host.sock"
}
