import type Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import Soup from 'gi://Soup?version=3.0'

// GJS has no fetch. The extensions that talk to a web API (open-meteo, the air
// quality endpoint) need nothing more than "GET this URL, give me the JSON",
// so that is the whole surface rather than a fetch polyfill.

const decoder = new TextDecoder()
const session = new Soup.Session()

export async function getJson<Result>(url: string): Promise<Result> {
  return JSON.parse(await getText(url)) as Result
}

export function getText(url: string): Promise<string> {
  const message = Soup.Message.new('GET', url)
  if (message === null) {
    return Promise.reject(new Error(`http: malformed url ${url}`))
  }
  return new Promise((resolve, reject) => {
    session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (source, result) => {
      settle(message, source, result, resolve, reject)
    })
  })
}

// Query strings are built here rather than through URLSearchParams, which GJS
// does not provide.
export function withQuery(url: string, params: Record<string, string | number>): string {
  const pairs: string[] = []
  for (const [key, value] of Object.entries(params)) {
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  }
  if (pairs.length === 0) {
    return url
  }
  return `${url}?${pairs.join('&')}`
}

function settle(
  message: Soup.Message,
  source: Soup.Session | null,
  result: Gio.AsyncResult,
  resolve: (value: string) => void,
  reject: (error: Error) => void,
): void {
  if (source === null) {
    reject(new Error('http: session vanished'))
    return
  }
  let bytes: GLib.Bytes
  try {
    bytes = source.send_and_read_finish(result)
  } catch (error) {
    reject(new Error(String(error)))
    return
  }
  const status = message.get_status()
  if (status < 200 || status >= 300) {
    reject(new Error(`http: ${message.get_uri().to_string()} returned ${status}`))
    return
  }
  resolve(decoder.decode(bytes.get_data() as Uint8Array))
}
