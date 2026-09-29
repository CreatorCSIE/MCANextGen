/**
 * Native embedding layer for the Electron Edition (plan.md Phase 3,
 * "Embedding architecture"): Electron's top-level HWND hosts a koffi-drawn
 * *clip container* (a WS_CHILD window whose only job is clipping and owning
 * the game window), and the game's HWND is reparented into it.
 *
 * The game window is converted to WS_CHILD on embed (see DECORATION_STYLE
 * below) and its decoration styles are saved, stripped and later restored, so
 * unembedding leaves the AWT frame exactly as the game created it. The frame
 * starts DECORATED and off-screen (the Java host parks it at -32000,-32000
 * when embedding is available): the native strip here is the primary
 * decoration path — measured, an undecorated SunAwtFrame breaks LWJGL2's
 * parented mode (plan.md risk #4 reversal) — and starting off-screen means
 * the caption is only ever painted where nobody can see it (no top-left
 * flash, no □× residue frames while docking).
 *
 * Teardown order is a hard rule (plan.md): always `unembedGameWindow` (or
 * kill the java process) before destroying the clip container or its host,
 * otherwise the game window is reparented into a destroyed HWND.
 */

import * as koffi from 'koffi'
import { decodeUtf16, readWindowPid, win32, win32Types, type HWND } from './win32'

// GWL indexes (the Ptr variants are used on x64; same indexes apply).
const GWL_STYLE = -16
const GWL_EXSTYLE = -20

// Styles stripped from the game window while embedded.
//
// WS_POPUP must be cleared and WS_CHILD set, not kept as a popup-with-parent:
// Win32 treats a WS_POPUP window that merely has a parent as an *owned* popup —
// positioned in SCREEN coordinates and never clipped by the parent. Only a
// WS_CHILD window is laid out against its parent's client area and clipped by
// it (the whole point of the container). The Java host launches the frame
// DECORATED (WS_OVERLAPPED) but parked off-screen at -32000,-32000 — an
// undecorated frame breaks LWJGL2's parented mode (plan.md risk #4 reversal) —
// so clearing WS_POPUP here is belt-and-braces for any AWT build that creates
// popups anyway. `unembedGameWindow` restores the saved style for the
// top-level fallback.
const DECORATION_STYLE =
  0x00c00000 /* WS_CAPTION */ |
  0x00040000 /* WS_THICKFRAME */ |
  0x00080000 /* WS_SYSMENU */ |
  0x00020000 /* WS_MINIMIZEBOX */ |
  0x00010000 /* WS_MAXIMIZEBOX */ |
  0x80000000 /* WS_POPUP (cleared; WS_CHILD is set instead below) */
const EDGE_EXSTYLE =
  0x00000001 /* WS_EX_DLGMODALFRAME */ |
  0x00000100 /* WS_EX_WINDOWEDGE */ |
  0x00000200 /* WS_EX_CLIENTEDGE */ |
  0x00020000 /* WS_EX_STATICEDGE */

// Clip container window: a plain child window that clips its children and
// redraws on resize; it never paints anything itself (the game covers it).
const CS_HREDRAW = 0x0002
const CS_VREDRAW = 0x0001
const WS_VISIBLE = 0x10000000
const WS_CHILD = 0x40000000
const WS_CLIPCHILDREN = 0x02000000

const SW_SHOW = 5
const SWP_NOZORDER = 0x0004
const SWP_NOMOVE = 0x0002
const SWP_NOSIZE = 0x0001
const SWP_FRAMECHANGED = 0x0020
const SWP_NOACTIVATE = 0x0010

const WM_QUIT = 0x0012
const PM_REMOVE = 1

const IDC_ARROW = 32512

const CLIP_CLASS_NAME = 'MCANextGenClipWindow'
/** Kept alive for the process: the UTF-16 class name buffer and the WndProc
 * registration must outlive every window of the class. */
let clipClassAtom = 0
let classNameBuffer: Buffer | null = null
let wndProcHandle: unknown = null

function utf16Z(value: string): Buffer {
  return Buffer.from(`${value}\0`, 'utf16le')
}

/**
 * Registers the clip window class once per process. The WndProc is a pure
 * DefWindowProcW passthrough — the container has no behaviour of its own yet
 * (WM_SIZE bookkeeping arrives with the Phase 4 resize synchronizer).
 *
 * Uses RegisterClassW rather than RegisterClassExW: the PoC measured
 * RegisterClassExW rejecting every well-formed WNDCLASSEXW with
 * ERROR_INVALID_PARAMETER from an x64 Node process, while the plain form
 * registers and creates windows reliably (see win32.ts). The container needs
 * no class icon, so nothing is lost.
 */
function ensureClipClass(): void {
  if (clipClassAtom !== 0) return
  const api = win32()
  const types = win32Types()
  const proto = koffi.proto('__stdcall', 'MCANextGen_WNDPROC', 'intptr_t', [
    'void*',
    'uint32',
    'uintptr_t',
    'intptr_t'
  ])
  // Registered callbacks stay callable until koffi.unregister; we keep the
  // handle for the process lifetime, so one registration is reused for every
  // clip window ever created.
  wndProcHandle = koffi.register(
    (hwnd: HWND, message: number, wParam: number, lParam: number): number =>
      api.DefWindowProcW(hwnd, message, wParam, lParam),
    koffi.pointer(proto)
  )
  const instance = api.GetModuleHandleW(null)
  const cursor = api.LoadCursorW(null, IDC_ARROW)
  classNameBuffer = utf16Z(CLIP_CLASS_NAME)
  const classBuffer = Buffer.alloc(koffi.sizeof(types.WNDCLASSW))
  koffi.encode(classBuffer, types.WNDCLASSW, {
    style: CS_HREDRAW | CS_VREDRAW,
    lpfnWndProc: wndProcHandle,
    cbClsExtra: 0,
    cbWndExtra: 0,
    hInstance: instance,
    hIcon: null,
    hCursor: cursor,
    hbrBackground: 3 /* (HBRUSH)(COLOR_WINDOW + 1) */,
    // Declared as void* in the struct: pass owned UTF-16 buffers directly
    // (lpszMenuName NULL, lpszClassName our process-lifetime buffer).
    lpszMenuName: null,
    lpszClassName: classNameBuffer
  })
  const atom = api.RegisterClassW(classBuffer)
  if (atom === 0) {
    throw new Error(`RegisterClassW failed for ${CLIP_CLASS_NAME} (GetLastError=${api.GetLastError()})`)
  }
  clipClassAtom = atom
}

/**
 * Creates the clip container as a WS_CHILD of `parentHwnd` (Electron's
 * top-level window handle) at the given parent-client-area rectangle, in
 * physical pixels. Returns its HWND.
 */
export function createClipContainer(
  parentHwnd: HWND,
  x: number,
  y: number,
  width: number,
  height: number
): HWND {
  ensureClipClass()
  const api = win32()
  const hwnd = api.CreateWindowExW(
    0,
    CLIP_CLASS_NAME,
    '',
    WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN,
    x,
    y,
    width,
    height,
    parentHwnd,
    null,
    api.GetModuleHandleW(null),
    null
  )
  if (!hwnd) throw new Error('CreateWindowExW (clip container) returned NULL')
  api.ShowWindow(hwnd, SW_SHOW)
  api.UpdateWindow(hwnd)
  return hwnd
}

/**
 * Raises the clip container to the top of its siblings inside the Electron
 * window. The web contents live in a sibling child window
 * (Chrome_RenderWidgetHostHWND); re-asserting top-of-z-order is the cheap
 * defence against the game area being painted over by the DOM. No move/resize,
 * no focus change.
 */
export function raiseClipContainer(clipHwnd: HWND): void {
  // insertAfter = HWND_TOP (0); passed as null (koffi maps it to the 0 handle).
  win32().SetWindowPos(
    clipHwnd,
    null,
    0,
    0,
    0,
    0,
    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE
  )
}

/** Moves/resizes the clip container inside its Electron parent (physical px). */
export function moveClipContainer(clipHwnd: HWND, x: number, y: number, width: number, height: number): void {
  if (!win32().MoveWindow(clipHwnd, x, y, width, height, true)) {
    throw new Error('MoveWindow (clip container) failed')
  }
}

/** Saved window styles needed to restore a game window after unembedding. */
export interface EmbeddingState {
  gameHwnd: HWND
  clipHwnd: HWND
  savedStyle: number
  savedExStyle: number
}

/**
 * Reparents the game window into the clip container and strips its window
 * decorations; `x/y/width/height` position it in clip-container client
 * coordinates (physical px). For fixed-size games, width/height are the game
 * resolution and never change. Returns the style snapshot for `unembed`.
 */
export function embedGameWindow(
  clipHwnd: HWND,
  gameHwnd: HWND,
  x: number,
  y: number,
  width: number,
  height: number
): EmbeddingState {
  const api = win32()
  // Unsigned 32-bit semantics: WS_POPUP (0x80000000) would flip to a negative
  // int32 under JS bitwise ops and then sign-extend into the 64-bit
  // SetWindowLongPtrW argument. `>>> 0` keeps every style a positive 32-bit.
  const savedStyle = api.GetWindowLongPtrW(gameHwnd, GWL_STYLE) >>> 0
  const savedExStyle = api.GetWindowLongPtrW(gameHwnd, GWL_EXSTYLE) >>> 0

  api.SetParent(gameHwnd, clipHwnd)
  // Clear decorations + WS_POPUP and set WS_CHILD: only then is the frame
  // laid out in the clip's client coordinates and clipped by it.
  const childStyle = ((savedStyle & ~DECORATION_STYLE) | WS_CHILD) >>> 0
  api.SetWindowLongPtrW(gameHwnd, GWL_STYLE, childStyle)
  api.SetWindowLongPtrW(gameHwnd, GWL_EXSTYLE, (savedExStyle & ~EDGE_EXSTYLE) >>> 0)
  if (!api.MoveWindow(gameHwnd, x, y, width, height, true)) {
    throw new Error('MoveWindow (game embed) failed')
  }
  // FRAMECHANGED makes Win32 (and AWT) recompute the non-client area now that
  // the decoration bits are gone; NOACTIVATE keeps focus where the UI has it.
  api.SetWindowPos(
    gameHwnd,
    null,
    0,
    0,
    0,
    0,
    SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED
  )
  return { gameHwnd, clipHwnd, savedStyle, savedExStyle }
}

/** Re-embeds after a resize (fixed-size games keep calling this only when the
 * letterbox position changes; resizable ones on every container resize). */
export function resizeEmbeddedGame(
  state: EmbeddingState,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  if (!win32().MoveWindow(state.gameHwnd, x, y, width, height, true)) {
    throw new Error('MoveWindow (embedded resize) failed')
  }
}

/**
 * Restores the game window to an unparented, fully decorated top-level window
 * (the state the game believes it is in). Must run *before* the clip
 * container — or any ancestor — is destroyed.
 */
export function unembedGameWindow(state: EmbeddingState): void {
  const api = win32()
  // Park off-screen *before* reparenting. While this is a WS_CHILD, MoveWindow
  // coordinates are parent-client-relative; the moment SetParent(null) promotes
  // it back to top-level those same coordinates are reinterpreted as absolute
  // screen coordinates — so if we left it wherever the clip had it, the window
  // would jump to the top-left of the screen and flash before the process dies.
  // The embed-failure path reverses this with bringWindowOnScreen immediately
  // after, so the rescue still works. Outer size is preserved via GetWindowRect.
  const types = win32Types()
  const buffer = Buffer.alloc(koffi.sizeof(types.RECT))
  if (api.GetWindowRect(state.gameHwnd, buffer)) {
    const r = koffi.decode(buffer, types.RECT) as unknown as {
      left: number
      top: number
      right: number
      bottom: number
    }
    api.MoveWindow(state.gameHwnd, -32000, -32000, r.right - r.left, r.bottom - r.top, false)
  }
  api.SetParent(state.gameHwnd, null)
  api.SetWindowLongPtrW(state.gameHwnd, GWL_STYLE, state.savedStyle)
  api.SetWindowLongPtrW(state.gameHwnd, GWL_EXSTYLE, state.savedExStyle)
  api.SetWindowPos(
    state.gameHwnd,
    null,
    0,
    0,
    0,
    0,
    SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED
  )
}

/**
 * Fallback for a frame the Java host parked off-screen (at -32000,-32000) for
 * embedding that never happened (tracker never found the window, or embedding
 * failed mid-way): move it back on-screen, preserving its size. Called *after*
 * `unembedGameWindow` restored the top-level decoration styles, or directly on
 * a still-top-level frame.
 */
export function bringWindowOnScreen(hwnd: HWND): void {
  const api = win32()
  const types = win32Types()
  const buffer = Buffer.alloc(koffi.sizeof(types.RECT))
  if (!api.GetWindowRect(hwnd, buffer)) return
  const r = koffi.decode(buffer, types.RECT) as unknown as {
    left: number
    top: number
    right: number
    bottom: number
  }
  const width = r.right - r.left
  const height = r.bottom - r.top
  if (r.left >= 0 && r.top >= 0) return // already on-screen
  api.MoveWindow(hwnd, 80, 80, width, height, true)
}

/** Destroys the clip container window (after every embedding was undone). */
export function destroyClipContainer(clipHwnd: HWND): void {
  if (!win32().DestroyWindow(clipHwnd)) throw new Error('DestroyWindow (clip) failed')
}

/**
 * Focus forwarding (plan.md risk #3 "Live update 2"): a parented LWJGL display
 * reads the keyboard from its OWN child HWND's wndproc, and `Mouse.setGrabbed`
 * only works while that HWND holds Win32 keyboard focus. Inside the embedding,
 * activation always lands the focus on Chromium's render widget (the DOM), so
 * after any focus loss (Alt+Tab away, a DOM click) the game sees keys as dead
 * and never captures the mouse — until somebody hands focus to the LWJGL
 * window explicitly. That is what these helpers do.
 */

/** LWJGL 2's parented display window class, and the AWT canvas under it. */
const FOCUS_TARGET_CLASSES = ['LWJGL', 'SunAwtCanvas']

/**
 * The window inside an embedded game frame that must hold keyboard focus:
 * the `LWJGL` child window (created inside the `SunAwtCanvas` peer), falling
 * back to the canvas, then to the frame itself. Pure metadata reads only
 * (EnumChildWindows + GetClassNameW) — never a SendMessage to the Java thread.
 */
export function findFocusTargetWithin(frameHwnd: HWND): HWND {
  const api = win32()
  const classBuffer = Buffer.alloc(512)
  let lwjgl: HWND | null = null
  let canvas: HWND | null = null
  api.EnumChildWindows(frameHwnd, (hwnd: HWND) => {
    const chars = api.GetClassNameW(hwnd, classBuffer, 256)
    if (chars <= 0) return true
    const name = decodeUtf16(classBuffer.subarray(0, chars * 2))
    if (name === FOCUS_TARGET_CLASSES[0]) {
      lwjgl = hwnd
      return false // stop: the real target is found
    }
    if (name === FOCUS_TARGET_CLASSES[1] && canvas === null) canvas = hwnd
    return true
  }, 0)
  return lwjgl ?? canvas ?? frameHwnd
}

/**
 * Moves Win32 keyboard focus to a foreign-thread window. SetFocus is only
 * legal cross-thread while the two input queues are attached; the attach is
 * transient here (the permanent embedding attach lives on the Java side).
 * The return value mirrors SetFocus (previous focus) — false can mean "failed"
 * or "nothing had focus before", so callers treat it as diagnostics only.
 */
export function focusNativeWindow(targetHwnd: HWND): boolean {
  const api = win32()
  const targetThread = readWindowPid(targetHwnd).threadId
  const ownThread = api.GetCurrentThreadId()
  const attached = targetThread === ownThread || api.AttachThreadInput(ownThread, targetThread, true)
  try {
    return api.SetFocus(targetHwnd) !== null
  } finally {
    if (attached && targetThread !== ownThread) {
      api.AttachThreadInput(ownThread, targetThread, false)
    }
  }
}

/**
 * The blur counterpart of `focusNativeWindow`: remove keyboard focus from the
 * game thread's window (`SetFocus(NULL)`), so the system delivers a genuine
 * WM_KILLFOCUS to the LWJGL window. Without this, cross-process activation
 * does NOT round-trip into the attached Java queue — the embedded game keeps
 * `isFocused=true` forever, never opens its pause menu on Alt+Tab away and
 * leaves the cursor clipped while you are in another application.
 * `hwndOfTargetThread` only identifies whose queue to attach to (any window
 * of the game process; the return value is the previously focused window).
 */
export function clearNativeFocus(hwndOfTargetThread: HWND): boolean {
  const api = win32()
  const targetThread = readWindowPid(hwndOfTargetThread).threadId
  const ownThread = api.GetCurrentThreadId()
  const attached = targetThread === ownThread || api.AttachThreadInput(ownThread, targetThread, true)
  try {
    return api.SetFocus(null) !== null
  } finally {
    if (attached && targetThread !== ownThread) {
      api.AttachThreadInput(ownThread, targetThread, false)
    }
  }
}

/** Client area of a window in physical pixels (verify/report only). */
export function readClientRect(hwnd: HWND): { width: number; height: number } {
  const api = win32()
  const types = win32Types()
  const buffer = Buffer.alloc(koffi.sizeof(types.RECT))
  if (!api.GetClientRect(hwnd, buffer)) throw new Error('GetClientRect failed')
  const rect = koffi.decode(buffer, types.RECT) as unknown as {
    left: number
    top: number
    right: number
    bottom: number
  }
  return { width: rect.right - rect.left, height: rect.bottom - rect.top }
}

/**
 * Diagnostics only: a window's screen rect, client size, parent and style, as
 * a single line. Used to answer "where did the embedded window actually go"
 * (invisible-embedding debugging) without guessing at z-order vs coordinates.
 */
export function describeWindowGeometry(hwnd: HWND): string {
  const api = win32()
  const types = win32Types()
  const buffer = Buffer.alloc(koffi.sizeof(types.RECT))
  let screen = 'rect=?'
  if (api.GetWindowRect(hwnd, buffer)) {
    const r = koffi.decode(buffer, types.RECT) as unknown as {
      left: number
      top: number
      right: number
      bottom: number
    }
    screen = `rect=(${r.left},${r.top})-(${r.right},${r.bottom}) ${r.right - r.left}x${r.bottom - r.top}`
  }
  const parent = api.GetParent(hwnd)
  const style = api.GetWindowLongPtrW(hwnd, GWL_STYLE) >>> 0
  const visible = api.IsWindowVisible(hwnd)
  return `hwnd=${hwndHexOf(hwnd)} ${screen} parent=${parent ? hwndHexOf(parent) : 'null'} visible=${visible} style=0x${style.toString(16)}`
}

function hwndHexOf(hwnd: HWND): string {
  const n = typeof hwnd === 'number' ? hwnd : Number(BigInt(String(hwnd)))
  return `0x${(n >>> 0).toString(16)}`
}

/**
 * Drains this thread's message queue (PM_REMOVE), dispatching to window
 * procedures — the pump the pure-native PoC and any dedicated embedding
 * thread runs. Returns true when a WM_QUIT was seen (the loop should end).
 * Inside Electron the main thread is already pumped by Chromium; this exists
 * for koffi-owned threads and PoC scripts.
 */
export function pumpMessages(): boolean {
  const api = win32()
  const types = win32Types()
  const buffer = Buffer.alloc(koffi.sizeof(types.MSG))
  let sawQuit = false
  while (api.PeekMessageW(buffer, null, 0, 0, PM_REMOVE)) {
    const message = koffi.decode(buffer, types.MSG) as unknown as { message: number }
    api.TranslateMessage(buffer)
    api.DispatchMessageW(buffer)
    if (message.message === WM_QUIT) {
      sawQuit = true
      break
    }
  }
  return sawQuit
}
