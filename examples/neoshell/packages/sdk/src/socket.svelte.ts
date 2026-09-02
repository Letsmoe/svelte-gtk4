// thin reactive wrapper around a raw WebSocket
// for talking directly to external services
// not the same as the neoshell backend connection

export function socket(url: string) {
  let ws: WebSocket | null = null;
  let state = $state({ connected: false });
  const listeners = new Map();

  function connect() {
    ws = new WebSocket(url);

    ws.onopen = () => (state.connected = true);
    ws.onclose = () => {
      state.connected = false;
      setTimeout(connect, 2000);
    };
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      const cbs = listeners.get("message");
      if (cbs) for (const cb of cbs) cb(data);
    };
  }

  connect();

  return {
    get connected() {
      return state.connected;
    },

    send(data: Object) {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
    },

    on(event: string, cb: (data: any) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(cb);
      return () => listeners.get(event).delete(cb);
    },

    close() {
      ws?.close();
    },
  };
}
