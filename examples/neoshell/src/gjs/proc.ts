import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

// Subprocess glue for the extensions that wrap a CLI tool (nmcli,
// bluetoothctl, brightnessctl, playerctl). Commands are argv arrays, never
// shell strings, so an SSID or device name carrying quotes or spaces needs no
// escaping. This is the GJS half of what the bun host did through Bun.spawn.

export interface CommandResult {
  ok: boolean
  stdout: string
  stderr: string
}

const PIPED = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
const STREAMED = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE

export function run(command: string[]): Promise<CommandResult> {
  const child = spawn(command, PIPED)
  if (child === null) {
    return Promise.resolve({ ok: false, stdout: '', stderr: `${command[0]} unavailable` })
  }
  return new Promise((resolve) => {
    child.communicate_utf8_async(null, null, (process, result) => {
      resolve(finishCommand(child, process, result))
    })
  })
}

// output returns stdout and swallows failure — for the many read-only probes
// where "the tool is missing" and "the tool found nothing" mean the same thing
// to the caller.
export async function output(command: string[]): Promise<string> {
  const result = await run(command)
  if (!result.ok) {
    return ''
  }
  return result.stdout
}

// watchLines streams a long-running command and calls onLine per line, then
// onEnd once the command's output closes — a tool that exits when its subject
// goes away (playerctl losing the last player) is how a caller learns to
// restart it. The returned disposer kills the child, so callers register it as
// an effect; it does not fire onEnd, since the caller asked for the stop.
export function watchLines(
  command: string[],
  onLine: (line: string) => void,
  onEnd?: () => void,
): () => void {
  const child = spawn(command, STREAMED)
  if (child === null) {
    console.error(`proc: cannot watch ${command[0]}`)
    return () => {}
  }
  const stream = new Gio.DataInputStream({ base_stream: child.get_stdout_pipe() as Gio.InputStream })
  const state = { stopped: false }
  readNextLine(stream, state, onLine, onEnd)
  return () => {
    state.stopped = true
    child.force_exit()
  }
}

// nmcli's terse mode separates fields with ":" and escapes literal colons as
// "\:", so a naive split shreds SSIDs and MAC addresses. splitTerse walks the
// line instead.
export function splitTerse(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let escaped = false
  for (const character of line) {
    ;({ current, escaped } = consumeTerseCharacter(fields, current, escaped, character))
  }
  fields.push(current)
  return fields
}

function consumeTerseCharacter(
  fields: string[],
  current: string,
  escaped: boolean,
  character: string,
): { current: string; escaped: boolean } {
  if (escaped) {
    return { current: current + character, escaped: false }
  }
  if (character === '\\') {
    return { current, escaped: true }
  }
  if (character === ':') {
    fields.push(current)
    return { current: '', escaped: false }
  }
  return { current: current + character, escaped: false }
}

function spawn(command: string[], flags: Gio.SubprocessFlags): Gio.Subprocess | null {
  try {
    return Gio.Subprocess.new(command, flags)
  } catch (error) {
    console.error(`proc: cannot spawn ${command[0]}:`, error)
    return null
  }
}

function finishCommand(
  child: Gio.Subprocess,
  process: Gio.Subprocess | null,
  result: Gio.AsyncResult,
): CommandResult {
  if (process === null) {
    return { ok: false, stdout: '', stderr: 'process vanished' }
  }
  try {
    const [, stdout, stderr] = process.communicate_utf8_finish(result)
    return {
      ok: child.get_successful(),
      stdout: trimmed(stdout),
      stderr: trimmed(stderr),
    }
  } catch (error) {
    return { ok: false, stdout: '', stderr: String(error) }
  }
}

function readNextLine(
  stream: Gio.DataInputStream,
  state: { stopped: boolean },
  onLine: (line: string) => void,
  onEnd: (() => void) | undefined,
): void {
  if (state.stopped) {
    return
  }
  stream.read_line_async(GLib.PRIORITY_DEFAULT, null, (source, result) => {
    const line = finishLine(source, result)
    if (state.stopped) {
      return
    }
    if (line === null) {
      callIfSet(onEnd)
      return
    }
    onLine(line)
    readNextLine(stream, state, onLine, onEnd)
  })
}

function callIfSet(handler: (() => void) | undefined): void {
  if (handler !== undefined) {
    handler()
  }
}

function finishLine(stream: Gio.DataInputStream | null, result: Gio.AsyncResult): string | null {
  if (stream === null) {
    return null
  }
  try {
    const [line] = stream.read_line_finish_utf8(result)
    return line
  } catch {
    return null
  }
}

function trimmed(value: string | null): string {
  if (value === null) {
    return ''
  }
  return value.trim()
}
