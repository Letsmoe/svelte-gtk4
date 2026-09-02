import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

// The filesystem calls the host and the extension backends used to make
// through node:fs. GJS has no node builtins, so every one of them lands on
// Gio.File. Reads are synchronous on purpose: they run against /sys, a config
// file, or a .desktop directory — all local, all small — and an async
// alternative would only spread `await` through callers that have nothing else
// to do while waiting.

const decoder = new TextDecoder()
const encoder = new TextEncoder()

export function readTextFile(path: string): string | null {
  const file = Gio.File.new_for_path(path)
  try {
    const [ok, contents] = file.load_contents(null)
    if (!ok) {
      return null
    }
    return decoder.decode(contents)
  } catch {
    return null
  }
}

export function writeTextFile(path: string, contents: string): boolean {
  const file = Gio.File.new_for_path(path)
  try {
    file.replace_contents(
      encoder.encode(contents),
      null,
      false,
      Gio.FileCreateFlags.REPLACE_DESTINATION,
      null,
    )
    return true
  } catch (error) {
    console.error(`fs: cannot write ${path}:`, error)
    return false
  }
}

export function fileExists(path: string): boolean {
  return GLib.file_test(path, GLib.FileTest.EXISTS)
}

export function isDirectory(path: string): boolean {
  return GLib.file_test(path, GLib.FileTest.IS_DIR)
}

export function makeDirectory(path: string): void {
  if (isDirectory(path)) {
    return
  }
  try {
    Gio.File.new_for_path(path).make_directory_with_parents(null)
  } catch (error) {
    console.error(`fs: cannot create ${path}:`, error)
  }
}

// Names only, unsorted — the caller decides the order it wants, the same way
// readdirSync left it.
export function readDirectory(path: string): string[] {
  const enumerator = openEnumerator(path)
  if (enumerator === null) {
    return []
  }
  const names: string[] = []
  for (;;) {
    const info = enumerator.next_file(null)
    if (info === null) {
      break
    }
    names.push(info.get_name())
  }
  enumerator.close(null)
  return names
}

export interface DirectoryEntry {
  name: string
  directory: boolean
}

// Names with their kind, in one enumeration — the alternative is a query_info
// per name, which on a folder of any size is the whole cost of the listing.
export function readDirectoryEntries(path: string): DirectoryEntry[] {
  const enumerator = openEnumerator(path, 'standard::name,standard::type')
  if (enumerator === null) {
    return []
  }
  const entries: DirectoryEntry[] = []
  for (;;) {
    const info = enumerator.next_file(null)
    if (info === null) {
      break
    }
    entries.push({
      name: info.get_name(),
      directory: info.get_file_type() === Gio.FileType.DIRECTORY,
    })
  }
  enumerator.close(null)
  return entries
}

export function renameTo(path: string, target: string): string {
  try {
    Gio.File.new_for_path(path).move(
      Gio.File.new_for_path(target),
      Gio.FileCopyFlags.NONE,
      null,
      null,
    )
    return ''
  } catch (error) {
    return String(error)
  }
}

// GIO implements the freedesktop trash spec — the ~/.local/share/Trash layout,
// the .trashinfo file, the collision numbering — so none of it is restated
// here the way the node build had to.
export function moveToTrash(path: string): string {
  try {
    Gio.File.new_for_path(path).trash(null)
    return ''
  } catch (error) {
    return String(error)
  }
}

export function modifiedAt(path: string): number {
  try {
    const info = Gio.File.new_for_path(path).query_info(
      'time::modified',
      Gio.FileQueryInfoFlags.NONE,
      null,
    )
    return info.get_attribute_uint64('time::modified')
  } catch {
    return 0
  }
}

// watchDirectory reports the base name of every file that changed inside dir.
// Watching the directory rather than the file is what lets a config file be
// followed before it exists, and survives the truncate-and-rewrite that an
// editor performs.
export function watchDirectory(path: string, onChange: (name: string) => void): () => void {
  let monitor: Gio.FileMonitor
  try {
    monitor = Gio.File.new_for_path(path).monitor_directory(Gio.FileMonitorFlags.NONE, null)
  } catch (error) {
    console.error(`fs: cannot watch ${path}:`, error)
    return () => {}
  }
  const handler = monitor.connect('changed', (_monitor, file) => {
    onChange(baseNameOf(file))
  })
  return () => {
    monitor.disconnect(handler)
    monitor.cancel()
  }
}

export function homeDirectory(): string {
  return GLib.get_home_dir()
}

export function runtimeDirectory(): string {
  const dir = GLib.getenv('XDG_RUNTIME_DIR')
  if (dir !== null && dir !== '') {
    return dir
  }
  return `/run/user/${GLib.get_user_name()}`
}

export function joinPath(...parts: string[]): string {
  return GLib.build_filenamev(parts)
}

function openEnumerator(path: string, attributes = 'standard::name'): Gio.FileEnumerator | null {
  try {
    return Gio.File.new_for_path(path).enumerate_children(
      attributes,
      Gio.FileQueryInfoFlags.NONE,
      null,
    )
  } catch {
    return null
  }
}

function baseNameOf(file: Gio.File): string {
  const name = file.get_basename()
  if (name === null) {
    return ''
  }
  return name
}
