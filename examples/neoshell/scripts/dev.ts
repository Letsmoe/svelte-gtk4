import { spawn } from 'node:child_process'
import { watch, type FSWatcher } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The development supervisor behind `task dev`. It runs three things:
//
//   vite dev server  serves <ext>/src/views.ts with HMR
//   host             pointed at that server, with NEOSHELL_HOT=1
//   host watcher     restarts the host when the host's own sources change
//
// Views are the fast path: a saved component is patched into the running
// surface by vite, with no rebuild and no remount. The host's own hot reload
// covers what vite cannot see — extension backends and the surface runtime.
// The core plugins swap in no live fiber at all, so a host source change is a
// restart: SIGTERM, which lets the host dispose and take the render host down
// with it, then a fresh spawn.

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOST_DIR = join(ROOT_DIR, 'apps/host')
const EXTENSIONS_DIR = join(ROOT_DIR, 'apps/extensions')
const VIEWS_DEV_ORIGIN = 'http://127.0.0.1:5174'
const RESTART_DEBOUNCE_MS = 200

type SpawnedProcess = ReturnType<typeof spawn>

async function main(): Promise<void> {
  const views = startViewsServer()
  await waitForViewsServer()
  const host = new HostProcess()
  const sources = watchHostSources(() => {
    void host.restart()
  })
  onShutdown(() => {
    sources.close()
    views.kill('SIGTERM')
    host.stop()
  })
  host.start()
}

function startViewsServer(): SpawnedProcess {
  return spawn('bun', ['run', 'dev:views'], { cwd: EXTENSIONS_DIR, stdio: 'inherit' })
}

// The webviews import their views the moment the host mounts them, so the
// server has to be answering before the host comes up.
async function waitForViewsServer(): Promise<void> {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (await viewsServerReachable()) {
      return
    }
    await Bun.sleep(100)
  }
  throw new Error(`dev: views server ${VIEWS_DEV_ORIGIN} did not come up`)
}

async function viewsServerReachable(): Promise<boolean> {
  try {
    await fetch(`${VIEWS_DEV_ORIGIN}/@vite/client`)
    return true
  } catch {
    return false
  }
}

function watchHostSources(onChange: () => void): FSWatcher {
  return watch(join(HOST_DIR, 'src'), { recursive: true }, debounced(onChange))
}

// HostProcess owns the one host at a time. A host that exits on its own has
// crashed or been asked to quit, and either way the supervisor has nothing
// left to supervise.
class HostProcess {
  private child: SpawnedProcess | null = null
  private restarting = false

  start(): void {
    console.log('dev: starting the host')
    const child = spawn('bun', ['src/main.ts'], {
      cwd: HOST_DIR,
      stdio: 'inherit',
      env: { ...process.env, NEOSHELL_HOT: '1', NEOSHELL_VIEWS_DEV: VIEWS_DEV_ORIGIN },
    })
    child.on('exit', (code) => this.handleExit(code))
    this.child = child
  }

  async restart(): Promise<void> {
    if (this.restarting) {
      return
    }
    this.restarting = true
    console.log('dev: host sources changed, restarting')
    await this.stopAndWait()
    this.restarting = false
    this.start()
  }

  stop(): void {
    this.restarting = true
    if (this.child !== null) {
      this.child.kill('SIGTERM')
    }
  }

  private handleExit(code: number | null): void {
    this.child = null
    if (this.restarting) {
      return
    }
    console.log(`dev: host exited (${code}), shutting down`)
    process.exit(exitCodeOf(code))
  }

  private async stopAndWait(): Promise<void> {
    const child = this.child
    if (child === null) {
      return
    }
    child.kill('SIGTERM')
    await new Promise<void>((resolve) => child.once('exit', () => resolve()))
  }
}

// The children share this process' group, so a terminal Ctrl-C already reaches
// them; the explicit stop is for the signals that do not, and for the host,
// which must be given the chance to dispose rather than be killed outright.
function onShutdown(stop: () => void): void {
  let stopping = false
  const shutdown = (): void => {
    if (stopping) {
      return
    }
    stopping = true
    stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  process.on('exit', stop)
}

function debounced(run: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return () => {
    if (timer !== null) {
      clearTimeout(timer)
    }
    timer = setTimeout(run, RESTART_DEBOUNCE_MS)
  }
}

function exitCodeOf(code: number | null): number {
  if (code === null) {
    return 1
  }
  return code
}

await main()
