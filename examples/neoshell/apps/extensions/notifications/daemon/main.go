// neoshell-notifyd owns org.freedesktop.Notifications on the session D-Bus and
// bridges it to the neoshell host bus over the unix socket wire protocol. It is
// the daemon half of the notifications extension — spawned and supervised by
// the extension's in-process backend, killed when the extension unloads.
//
//	notifications.event            add/close events for the UI
//	notification:action {id, key}  invoke a notification action
//	notification:close  {id, reason}
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

// wireMessage is one NDJSON line on the host socket.
type wireMessage struct {
	Type      string          `json:"type,omitempty"`
	Data      json.RawMessage `json:"data,omitempty"`
	Subscribe []string        `json:"subscribe,omitempty"`
}

func main() {
	socketPath := flag.String("socket", defaultSocketPath(), "neoshell host bus socket")
	flag.Parse()

	for {
		if err := run(*socketPath); err != nil {
			log.Printf("notifyd: %v; retrying", err)
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

	writeLine := func(message wireMessage) {
		raw, err := json.Marshal(message)
		if err != nil {
			return
		}
		_, _ = conn.Write(append(raw, '\n'))
	}

	daemon, err := NewDaemon(func(event Event) {
		data, err := json.Marshal(event)
		if err != nil {
			return
		}
		writeLine(wireMessage{Type: "notifications.event", Data: data})
	})
	if err != nil {
		return fmt.Errorf("claim notifications name: %w", err)
	}

	writeLine(wireMessage{Subscribe: []string{"notification:action", "notification:close"}})
	log.Printf("notifyd: bridging org.freedesktop.Notifications to %s", socketPath)

	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		handleCommand(daemon, scanner.Bytes())
	}
	return fmt.Errorf("host bus connection closed")
}

// handleCommand dispatches one bus message to the D-Bus daemon.
func handleCommand(daemon *Daemon, raw []byte) {
	var message struct {
		Type string `json:"type"`
		Data struct {
			ID     uint32 `json:"id"`
			Key    string `json:"key"`
			Reason int    `json:"reason"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &message); err != nil {
		return
	}
	switch message.Type {
	case "notification:action":
		daemon.InvokeAction(message.Data.ID, message.Data.Key)
	case "notification:close":
		daemon.closed(message.Data.ID, message.Data.Reason)
		daemon.Close(message.Data.ID, message.Data.Reason)
	}
}

func defaultSocketPath() string {
	runtime := os.Getenv("XDG_RUNTIME_DIR")
	if runtime == "" {
		runtime = fmt.Sprintf("/run/user/%d", os.Getuid())
	}
	return runtime + "/neoshell-host.sock"
}
