// Globals GJS provides that are neither Node nor DOM. Declared here so the
// project does not have to pull in lib.dom and pretend `document` exists.

declare const console: {
  log(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
  debug(...args: any[]): void;
  info(...args: any[]): void;
};

declare function print(...args: any[]): void;
declare function printerr(...args: any[]): void;
declare function logError(error: unknown, message?: string): void;

declare function setTimeout(handler: () => void, timeout?: number): number;
declare function clearTimeout(id?: number): void;
declare function setInterval(handler: () => void, timeout?: number): number;
declare function clearInterval(id?: number): void;
declare function queueMicrotask(callback: () => void): void;

declare class TextEncoder {
  constructor(encoding?: string);
  encode(input?: string): Uint8Array;
}

declare class TextDecoder {
  constructor(encoding?: string);
  decode(input?: Uint8Array): string;
}
