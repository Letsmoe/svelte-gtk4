// One runner process and its frames. Nothing here ever blocks the host's main
// loop on the client: reads and writes are asynchronous, a client that stops
// reading is cut off once too much is queued for it, and one whose frames
// break the protocol is killed.

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { type ClientMessage, type HostMessage, MAX_FRAME_BYTES } from "./protocol";

const READ_CHUNK_BYTES = 64 * 1024;
const MAX_QUEUED_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_LINES_PER_SECOND = 50;

export interface ProcessOptions {
  /** The command line, already wrapped in whatever sandbox the host uses. */
  argv: string[];
  label: string;
  onMessage(message: ClientMessage): void;
  /** Called once, when the process is gone for any reason. */
  onExit(reason: string): void;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class ClientProcess {
  private readonly options: ProcessOptions;
  private process: Gio.Subprocess | null = null;
  private input: Uint8Array = new Uint8Array(0);
  private writing = false;
  private queue: Uint8Array[] = [];
  private queuedBytes = 0;
  private exited = false;
  private paused = false;
  private stderrWindowStart = 0;
  private stderrLines = 0;

  constructor(options: ProcessOptions) {
    this.options = options;
  }

  start(): void {
    const flags =
      Gio.SubprocessFlags.STDIN_PIPE |
      Gio.SubprocessFlags.STDOUT_PIPE |
      Gio.SubprocessFlags.STDERR_PIPE;
    try {
      this.process = Gio.Subprocess.new(this.options.argv, flags);
    } catch (error) {
      this.finish(`could not start: ${String(error)}`);
      return;
    }
    this.process.wait_async(null, (process, result) => {
      try {
        process?.wait_finish(result);
      } catch {
        // The exit status below says what happened.
      }
      this.finish(this.exitReason());
    });
    this.readStdout();
    this.readStderr(new Gio.DataInputStream({ base_stream: this.process.get_stderr_pipe() }));
  }

  send(message: HostMessage): void {
    if (this.process === null || this.exited) {
      return;
    }
    const body = encoder.encode(JSON.stringify(message));
    const frame = new Uint8Array(4 + body.length);
    new DataView(frame.buffer).setUint32(0, body.length, true);
    frame.set(body, 4);
    this.queuedBytes += frame.length;
    if (this.queuedBytes > MAX_QUEUED_BYTES) {
      this.kill("stopped reading what the host sends");
      return;
    }
    this.queue.push(frame);
    this.writeNext();
  }

  /** Stops reading for a while; the runner blocks once its pipe is full. */
  pause(milliseconds: number): void {
    if (this.paused) {
      return;
    }
    this.paused = true;
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
      this.paused = false;
      this.readStdout();
      return GLib.SOURCE_REMOVE;
    });
  }

  kill(reason: string): void {
    if (this.process === null || this.exited) {
      return;
    }
    console.warn(`${this.options.label}: stopped: ${reason}`);
    this.process.force_exit();
    this.finish(reason);
  }

  private writeNext(): void {
    if (this.writing || this.queue.length === 0 || this.process === null || this.exited) {
      return;
    }
    const stdin = this.process.get_stdin_pipe();
    if (stdin === null) {
      return;
    }
    const frame = this.queue.shift() as Uint8Array;
    this.writing = true;
    stdin.write_all_async(frame, GLib.PRIORITY_DEFAULT, null, (_stream, result) => {
      this.writing = false;
      this.queuedBytes -= frame.length;
      try {
        stdin.write_all_finish(result);
      } catch {
        this.kill("its input closed");
        return;
      }
      this.writeNext();
    });
  }

  private readStdout(): void {
    if (this.process === null || this.exited || this.paused) {
      return;
    }
    const stdout = this.process.get_stdout_pipe();
    if (stdout === null) {
      return;
    }
    stdout.read_bytes_async(READ_CHUNK_BYTES, GLib.PRIORITY_DEFAULT, null, (_stream, result) => {
      let bytes: GLib.Bytes;
      try {
        bytes = stdout.read_bytes_finish(result);
      } catch {
        return;
      }
      const chunk = bytes.toArray();
      if (chunk.length === 0) {
        return;
      }
      this.takeInput(chunk);
      this.readStdout();
    });
  }

  private takeInput(chunk: Uint8Array): void {
    const joined = new Uint8Array(this.input.length + chunk.length);
    joined.set(this.input);
    joined.set(chunk, this.input.length);
    this.input = joined;
    while (!this.exited) {
      const frame = this.nextFrame();
      if (frame === null) {
        return;
      }
      this.deliver(frame);
    }
  }

  private nextFrame(): string | null {
    if (this.input.length < 4) {
      return null;
    }
    const length = new DataView(this.input.buffer, this.input.byteOffset).getUint32(0, true);
    if (length > MAX_FRAME_BYTES) {
      this.kill(`sent a frame of ${length} bytes`);
      return null;
    }
    if (this.input.length < 4 + length) {
      return null;
    }
    const frame = decoder.decode(this.input.subarray(4, 4 + length));
    this.input = this.input.slice(4 + length);
    return frame;
  }

  private deliver(frame: string): void {
    let message: ClientMessage;
    try {
      message = JSON.parse(frame) as ClientMessage;
    } catch {
      this.kill("sent a frame that is not JSON");
      return;
    }
    this.options.onMessage(message);
  }

  private readStderr(stream: Gio.DataInputStream): void {
    stream.read_line_async(GLib.PRIORITY_LOW, null, (_stream, result) => {
      let line: string | null;
      try {
        [line] = stream.read_line_finish_utf8(result);
      } catch {
        return;
      }
      if (line === null) {
        return;
      }
      this.logLine(line);
      this.readStderr(stream);
    });
  }

  // A client printing in a loop must not fill the journal.
  private logLine(line: string): void {
    const now = GLib.get_monotonic_time() / 1000;
    if (now - this.stderrWindowStart > 1000) {
      this.stderrWindowStart = now;
      this.stderrLines = 0;
    }
    this.stderrLines += 1;
    if (this.stderrLines > MAX_STDERR_LINES_PER_SECOND) {
      return;
    }
    console.log(`${this.options.label}: ${line.slice(0, 2000)}`);
  }

  private exitReason(): string {
    if (this.process === null) {
      return "never started";
    }
    if (this.process.get_if_signaled()) {
      return `killed by signal ${this.process.get_term_sig()}`;
    }
    return `exited with status ${this.process.get_exit_status()}`;
  }

  private finish(reason: string): void {
    if (this.exited) {
      return;
    }
    this.exited = true;
    this.queue = [];
    this.options.onExit(reason);
  }
}
