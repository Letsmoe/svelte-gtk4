// Shared subprocess glue for extensions that wrap a CLI tool (nmcli,
// bluetoothctl, brightnessctl). Commands are argv arrays, never shell strings,
// so an SSID or device name carrying quotes or spaces needs no escaping.

export interface CommandResult {
  ok: boolean
  stdout: string
  stderr: string
}

export async function run(command: string[]): Promise<CommandResult> {
  let child: ReturnType<typeof Bun.spawn>
  try {
    child = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' })
  } catch (error) {
    return { ok: false, stdout: '', stderr: `${command[0]} unavailable: ${error}` }
  }
  const stdout = await new Response(child.stdout as ReadableStream).text()
  const stderr = await new Response(child.stderr as ReadableStream).text()
  const exitCode = await child.exited
  return { ok: exitCode === 0, stdout: stdout.trim(), stderr: stderr.trim() }
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

// watchLines streams a long-running command and calls onLine per line. The
// returned disposer kills the child, so callers register it as an effect.
export function watchLines(command: string[], onLine: (line: string) => void): () => void {
  let child: ReturnType<typeof Bun.spawn>
  try {
    child = Bun.spawn(command, { stdout: 'pipe', stderr: 'ignore' })
  } catch (error) {
    console.error(`proc: cannot watch ${command[0]}:`, error)
    return () => {}
  }
  void forwardLines(child, onLine)
  return () => child.kill()
}

async function forwardLines(
  child: ReturnType<typeof Bun.spawn>,
  onLine: (line: string) => void,
): Promise<void> {
  const decoder = new TextDecoder()
  let buffered = ''
  for await (const chunk of child.stdout as ReadableStream<Uint8Array>) {
    buffered += decoder.decode(chunk, { stream: true })
    buffered = drainLines(buffered, onLine)
  }
}

function drainLines(buffered: string, onLine: (line: string) => void): string {
  const lines = buffered.split('\n')
  const remainder = lines.pop()
  for (const line of lines) {
    onLine(line)
  }
  if (remainder === undefined) {
    return ''
  }
  return remainder
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
