/**
 * Low-level Win32 bindings through koffi (N-API stable ABI: no node-gyp and
 * no Electron rebuild are ever required).
 *
 * Phase 2 covers finding and describing native windows; Phase 3 adds window
 * creation, class registration, reparenting/style mutation and the message
 * pump the clip container's WndProc needs. Higher layers (embedder.ts) build
 * on these bindings and never call koffi directly.
 *
 * All bindings are created lazily on first use so that importing this module
 * on a non-Windows platform (future phases, dev machines) never touches
 * `koffi.load`. Note the cache is all-or-nothing: a wrong signature throws
 * out of `win32()` entirely, so new bindings must match the Win32 ABI exactly.
 */

import * as koffi from 'koffi'

/** An opaque HWND as handed to/from koffi callbacks and calls. */
export type HWND = unknown

const GW_OWNER = 4

interface Win32Api {
  EnumWindows(proc: (hwnd: HWND, lParam: number) => boolean, lParam: number): boolean
  EnumChildWindows(
    parent: HWND,
    proc: (hwnd: HWND, lParam: number) => boolean,
    lParam: number
  ): boolean
  GetWindowThreadProcessId(hwnd: HWND, pidOut: Uint32Array): number
  IsWindow(hwnd: HWND): boolean
  IsWindowVisible(hwnd: HWND): boolean
  GetWindowLongPtrW(hwnd: HWND, index: number): number
  GetWindow(hwnd: HWND, command: number): HWND | null
  GetClassNameW(hwnd: HWND, buffer: Buffer, maxChars: number): number
  /**
   * SendMessageTimeoutW: the only safe way to read text from a *foreign*
   * window. GetWindowText/GetWindowTextLength send bare WM_GETTEXT messages
   * cross-process, which block the calling thread until the owning thread
   * answers — a deadlock once embedding attaches our UI thread's input queue
   * to the game's (see windows.ts safeWindowTitle).
   */
  SendMessageTimeoutW(
    hwnd: HWND,
    message: number,
    wParam: number,
    lParam: Buffer | null,
    flags: number,
    timeoutMs: number,
    resultOut: Uint32Array
  ): number
  // --- Phase 3: window creation + embedding -------------------------------
  GetModuleHandleW(name: null): unknown
  LoadCursorW(instance: unknown, resourceName: number): unknown
  /**
   * RegisterClassW (the non-EX WNDCLASS form), not RegisterClassExW: in the
   * Phase 3 pure-native PoC every RegisterClassExW call — hand-encoded or
   * koffi-encoded, with stock brushes or color+1 backgrounds, correct or
   * padded `cbSize` — failed with ERROR_INVALID_PARAMETER (87) from an x64
   * Node process, while a byte-identical WNDCLASSW struct registered fine
   * through RegisterClassW. The clip container has no icon to carry, so the
   * plain form loses nothing.
   */
  RegisterClassW(classBuffer: Buffer): number
  UnregisterClassW(className: string, instance: unknown): boolean
  CreateWindowExW(
    exStyle: number,
    className: string,
    windowName: string,
    style: number,
    x: number,
    y: number,
    width: number,
    height: number,
    parent: HWND | null,
    menu: unknown,
    instance: unknown,
    param: unknown
  ): HWND | null
  DefWindowProcW(hwnd: HWND, message: number, wParam: number, lParam: number): number
  DestroyWindow(hwnd: HWND): boolean
  ShowWindow(hwnd: HWND, command: number): boolean
  UpdateWindow(hwnd: HWND): boolean
  SetParent(hwnd: HWND, newParent: HWND | null): HWND | null
  MoveWindow(hwnd: HWND, x: number, y: number, width: number, height: number, repaint: boolean): boolean
  SetWindowLongPtrW(hwnd: HWND, index: number, newLong: number): number
  SetWindowPos(
    hwnd: HWND,
    insertAfter: HWND | null,
    x: number,
    y: number,
    width: number,
    height: number,
    flags: number
  ): boolean
  GetClientRect(hwnd: HWND, rectBuffer: Buffer): boolean
  GetWindowRect(hwnd: HWND, rectBuffer: Buffer): boolean
  GetParent(hwnd: HWND): HWND | null
  // --- Phase 3: message pump for the clip container ------------------------
  PeekMessageW(msgBuffer: Buffer, hwnd: HWND | null, msgMin: number, msgMax: number, remove: number): boolean
  TranslateMessage(msgBuffer: Buffer): boolean
  DispatchMessageW(msgBuffer: Buffer): number
  PostQuitMessage(exitCode: number): void
  GetLastError(): number
  // --- Phase 3: focus forwarding --------------------------------------------
  /**
   * SetFocus: cross-thread only works while the target thread's input queue is
   * attached to ours (AttachThreadInput) — embedding attaches them implicitly
   * for messages, but the explicit attach is what makes a foreign-HWND focus
   * change legal from the Chromium UI thread.
   */
  SetFocus(hwnd: HWND): HWND | null
  AttachThreadInput(idAttach: number, idAttachTo: number, attach: boolean): boolean
  GetCurrentThreadId(): number
}

/**
 * Struct layouts are registered once alongside the bindings (anonymous types:
 * no global koffi names to collide with on module reload). Exposed for the
 * pump/creator code that needs `sizeof` and encode/decode buffers.
 */
// koffi does not export its TypeObject/TypeSpec aliases; the struct() return
// is exactly what sizeof/encode/decode accept as a TypeSpec.
type KoffiStructType = ReturnType<typeof koffi.struct>

interface Win32Types {
  /** MSG: hwnd, message, wParam, lParam, time, pt — as laid out on x64. */
  MSG: KoffiStructType
  /** RECT: left, top, right, bottom. */
  RECT: KoffiStructType
  /** WNDCLASSW with the string slots as owned UTF-16 buffers (void*). */
  WNDCLASSW: KoffiStructType
}

let apiCache: Win32Api | null = null
let typesCache: Win32Types | null = null

function bindTypes(): Win32Types {
  const point = koffi.struct({ x: 'int', y: 'int' })
  return {
    MSG: koffi.struct({
      hwnd: 'void*',
      message: 'uint32',
      wParam: 'uintptr_t',
      lParam: 'intptr_t',
      time: 'uint32',
      pt: point
    }),
    RECT: koffi.struct({ left: 'int', top: 'int', right: 'int', bottom: 'int' }),
    WNDCLASSW: koffi.struct({
      style: 'uint32',
      // koffi's Buffer-as-void* handling is fine here; each pointer slot is
      // passed as an owned buffer / registered callback address.
      lpfnWndProc: 'void*',
      cbClsExtra: 'int',
      cbWndExtra: 'int',
      hInstance: 'void*',
      hIcon: 'void*',
      hCursor: 'void*',
      hbrBackground: 'void*',
      lpszMenuName: 'void*',
      lpszClassName: 'void*'
    })
  }
}

/** koffi struct descriptors for buffers passed to the API above. */
export function win32Types(): Win32Types {
  if (typesCache) return typesCache
  win32() // binds lazily together with the API
  typesCache ??= bindTypes()
  return typesCache
}

/** Win32 entry points bound on first use (throws off-Windows by design). */
export function win32(): Win32Api {
  if (apiCache) return apiCache
  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')
  const api: Win32Api = {
    // A function-pointer parameter must be a *pointer to* the callback proto,
    // not the proto itself (koffi rejects the bare proto as a parameter).
    EnumWindows: user32.func('__stdcall', 'EnumWindows', 'bool', [
      koffi.pointer(koffi.proto('__stdcall', 'WNDENUMPROC', 'bool', ['void*', 'intptr_t'])),
      'intptr_t'
    ]),
    // Separate proto name: koffi registers protos globally by name.
    EnumChildWindows: user32.func('__stdcall', 'EnumChildWindows', 'bool', [
      'void*',
      koffi.pointer(koffi.proto('__stdcall', 'CHILDENUMPROC', 'bool', ['void*', 'intptr_t'])),
      'intptr_t'
    ]),
    GetWindowThreadProcessId: user32.func('__stdcall', 'GetWindowThreadProcessId', 'uint32', [
      'void*',
      'uint32*'
    ]),
    IsWindowVisible: user32.func('__stdcall', 'IsWindowVisible', 'bool', ['void*']),
    IsWindow: user32.func('__stdcall', 'IsWindow', 'bool', ['void*']),
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
    SendMessageTimeoutW: user32.func('__stdcall', 'SendMessageTimeoutW', 'intptr_t', [
      'void*',
      'uint32',
      'uintptr_t',
      'void*',
      'uint32',
      'uint32',
      'uint32*'
    ]),
    // NULL (the only argument we pass) retrieves the exe module handle; the
    // parameter is `void*` because koffi's `str16` rejects null.
    GetModuleHandleW: kernel32.func('__stdcall', 'GetModuleHandleW', 'void*', ['void*']),
    // IDC_ARROW is MAKEINTRESOURCE(32512): a small integer passed as LPCWSTR,
    // hence the `void*` parameter type instead of `str16`.
    LoadCursorW: user32.func('__stdcall', 'LoadCursorW', 'void*', ['void*', 'void*']),
    RegisterClassW: user32.func('__stdcall', 'RegisterClassW', 'uint16', ['void*']),
    UnregisterClassW: user32.func('__stdcall', 'UnregisterClassW', 'bool', ['str16', 'void*']),
    CreateWindowExW: user32.func('__stdcall', 'CreateWindowExW', 'void*', [
      'uint32',
      'str16',
      'str16',
      'uint32',
      'int',
      'int',
      'int',
      'int',
      'void*',
      'void*',
      'void*',
      'void*'
    ]),
    // LRESULT/WPARAM/LPARAM as 32-bit-significant JS numbers (see above).
    DefWindowProcW: user32.func('__stdcall', 'DefWindowProcW', 'intptr_t', [
      'void*',
      'uint32',
      'uintptr_t',
      'intptr_t'
    ]),
    DestroyWindow: user32.func('__stdcall', 'DestroyWindow', 'bool', ['void*']),
    ShowWindow: user32.func('__stdcall', 'ShowWindow', 'bool', ['void*', 'int']),
    UpdateWindow: user32.func('__stdcall', 'UpdateWindow', 'bool', ['void*']),
    SetParent: user32.func('__stdcall', 'SetParent', 'void*', ['void*', 'void*']),
    MoveWindow: user32.func('__stdcall', 'MoveWindow', 'bool', [
      'void*',
      'int',
      'int',
      'int',
      'int',
      'bool'
    ]),
    SetWindowLongPtrW: user32.func('__stdcall', 'SetWindowLongPtrW', 'intptr_t', [
      'void*',
      'int',
      'intptr_t'
    ]),
    SetWindowPos: user32.func('__stdcall', 'SetWindowPos', 'bool', [
      'void*',
      'void*',
      'int',
      'int',
      'int',
      'int',
      'uint32'
    ]),
    GetClientRect: user32.func('__stdcall', 'GetClientRect', 'bool', ['void*', 'void*']),
    GetWindowRect: user32.func('__stdcall', 'GetWindowRect', 'bool', ['void*', 'void*']),
    GetParent: user32.func('__stdcall', 'GetParent', 'void*', ['void*']),
    PeekMessageW: user32.func('__stdcall', 'PeekMessageW', 'bool', [
      'void*',
      'void*',
      'uint32',
      'uint32',
      'uint32'
    ]),
    TranslateMessage: user32.func('__stdcall', 'TranslateMessage', 'bool', ['void*']),
    DispatchMessageW: user32.func('__stdcall', 'DispatchMessageW', 'intptr_t', ['void*']),
    PostQuitMessage: user32.func('__stdcall', 'PostQuitMessage', 'void', ['int']),
    GetLastError: kernel32.func('__stdcall', 'GetLastError', 'uint32', []),
    SetFocus: user32.func('__stdcall', 'SetFocus', 'void*', ['void*']),
    AttachThreadInput: user32.func('__stdcall', 'AttachThreadInput', 'bool', [
      'uint32',
      'uint32',
      'bool'
    ]),
    GetCurrentThreadId: kernel32.func('__stdcall', 'GetCurrentThreadId', 'uint32', [])
  }
  apiCache = api
  typesCache = bindTypes()
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
