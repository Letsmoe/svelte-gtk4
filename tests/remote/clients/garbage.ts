// A client that skips Svelte and writes operations by hand, to check what
// the host does with ones Svelte would never send.

const runner = (globalThis as any).__runner

function send(message: unknown): void {
  runner.send(JSON.stringify(message))
}

;(globalThis as any).__receive = (text: string) => {
  const message = JSON.parse(text)
  if (message.t === 'ping') {
    send({ t: 'pong', seq: message.seq })
    return
  }
  if (message.t !== 'mount') {
    return
  }
  const root = 1000 + message.instance
  send({ t: 'batch', ops: [[9, message.instance, root]] })
  if (message.props.fault === 'cycle') {
    send({ t: 'batch', ops: [[0, 1, 'gtkbox'], [0, 2, 'gtkbox'], [4, 1, 2, 0], [4, 2, 1, 0]] })
  }
  if (message.props.fault === 'unknown-id') {
    send({ t: 'batch', ops: [[4, root, 4242, 0]] })
  }
  if (message.props.fault === 'remove-root') {
    send({ t: 'batch', ops: [[5, root]] })
  }
  if (message.props.fault === 'not-json') {
    runner.send('{ this is not json')
  }
  if (message.props.fault === 'silent') {
    ;(globalThis as any).__receive = () => {}
  }
}

send({ t: 'ready' })
