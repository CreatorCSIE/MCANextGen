/**
 * Low-level Win32 bindings through koffi (N-API stable ABI: no node-gyp and
 * no Electron rebuild are ever required).
 *
 * Scope is deliberately Phase 2 — everything needed to *find and describe*
 * native windows of a given process. Style mutation / reparenting arrives in
 * Phase 3 and will extend this file, not the higher layers.
 *
 * All bindings are created lazily on first use so that importing this module
 * on a non-Windows platform (future phases, dev machines) never touches
 * `koffi.load`.
 */

import * as koffi from 'koffi'

/** An opaque HWND as handed to/from koffi callbacks and calls. */
export type HWND = unknown

const GW_OWNER = 4

interface Win32Api {
  EnumWindows(proc: (hwnd: HWND, lParam: number) => boolean, lParam: number): boolean
  GetWindowThreadProcessId(hwnd: HWND, pidOut: Uint32Array): number
  IsWindowVisible(hwnd: HWND): boolean
  GetWindowLongPtrW(hwnd: HWND, index: number): number
  GetWindow(hwnd: HWND, command: number): HWND | null
  GetClassNameW(hwnd: HWND, buffer: Buffer, maxChars: number): number
  GetWindowTextLengthW(hwnd: HWND): number
  GetWindowTextW(hwnd: HWND, buffer: Buffer, maxChars: number): number
}

let apiCache: Win32Api | null = null

/** Win32 entry points bound on first use (throws off-Windows by design). */
export function win32(): Win32Api {
  if (apiCache) return apiCache
  const user32 = koffi.load('user32.dll')
  const api: Win32Api = {
    // A function-pointer parameter must be a *pointer to* the callback proto,
    // not the proto itself (koffi rejects the bare proto as a parameter).
    EnumWindows: user32.func('__stdcall', 'EnumWindows', 'bool', [
      koffi.pointer(koffi.proto('__stdcall', 'WNDENUMPROC', 'bool', ['void*', 'intptr_t'])),
      'intptr_t'
    ]),
    GetWindowThreadProcessId: user32.func('__stdcall', 'GetWindowThreadProcessId', 'uint32', [
      'void*',
      'uint32*'
    ]),
    IsWindowVisible: user32.func('__stdcall', 'IsWindowVisible', 'bool', ['void*']),
    // LONG_PTR: on x64 HWND-carrying values are ≤ 32 significant bits by
    // platform guarantee, so a JS number is safe for styles and addresses.
    GetWindowLongPtrW: user32.func('__stdcall', 'GetWindowLongPtrW', 'intptr_t', [
      'void*',
      'int'
    ]),
    GetWindow: user32.func('__stdcall', 'GetWindow', 'void*', ['void*', 'uint32']),
    // koffi's signed 32-bit type name is `int` (`sint32` does not exist).
    GetClassNameW: user32.func('__stdcall', 'GetClassNameW', 'int', [
      'void*',
      'void*',
      'int'
    ]),
    GetWindowTextLengthW: user32.func('__stdcall', 'GetWindowTextLengthW', 'int', ['void*']),
    GetWindowTextW: user32.func('__stdcall', 'GetWindowTextW', 'int', ['void*', 'void*', 'int'])
  }
  apiCache = api
  return api
}

/** Numeric address of an HWND (handles are 32-bit significant on Windows). */
export function hwndAddress(hwnd: HWND): number {
  return Number(koffi.address(hwnd as never))
}

/** Stable `0x…` text for logs and the status panel. */
export function hwndHex(hwnd: HWND): string {
  return `0x${hwndAddress(hwnd).toString(16)}`
}

/** Decodes a UTF-16 buffer up to the first NUL (or capacity), no koffi type games. */
export function decodeUtf16(buffer: Buffer): string {
  const end = Math.min(buffer.length - (buffer.length % 2), buffer.length)
  for (let i = 0; i + 1 < end; i += 2) {
    if (buffer.readUInt16LE(i) === 0) return buffer.toString('utf16le', 0, i)
  }
  return buffer.toString('utf16le', 0, end - (end % 2))
}

export function readWindowPid(hwnd: HWND): { pid: number; threadId: number } {
  const pidOut = new Uint32Array(1)
  const threadId = win32().GetWindowThreadProcessId(hwnd, pidOut)
  return { pid: pidOut[0], threadId }
}

export function hasOwnerWindow(hwnd: HWND): boolean {
  return win32().GetWindow(hwnd, GW_OWNER) !== null
}
