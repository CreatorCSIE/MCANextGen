/**
 * Enumerate top-level windows and identify the Minecraft game window by its
 * process id (Phase 2: “detect by process, not by title”).
 *
 * The owning-PID check (`GetWindowThreadProcessId`) narrows the field, and the
 * game-window lookup additionally anchors on the known window classes
 * (`SunAwtFrame`/`LWJGL`, see findGameWindow) because pid-only matching also
 * catches foreign helper windows injected into the process (IME status
 * windows). Title is only reported/preferred, never required — titles vary
 * per version and rename (the isom preview even uses its own title, see
 * appletWindowTitle). `EnumWindows` only yields top-level windows, so child
 * windows never appear; the extra filters keep invisible helper and owned tool
 * windows out of the candidate set.
 */

import { decodeUtf16, hasOwnerWindow, hwndHex, readWindowPid, win32, type HWND } from './win32'

/** WM_GETTEXT (the only message we send, always through SendMessageTimeout). */
const WM_GETTEXT = 0x000d
/** Bail out instead of blocking when the owning thread is busy or hung. */
const SMTO_ABORTIFHUNG = 0x0002
const TITLE_TIMEOUT_MS = 100
const TITLE_MAX_CHARS = 256

/**
 * Window title of a foreign window, hang-safely. `GetWindowText` sends a bare
 * WM_GETTEXT cross-process and blocks this thread until the owning thread
 * answers; once the game window is embedded (cross-process SetParent attaches
 * the Java thread's input queue to ours) such a send can deadlock against the
 * activation traffic the click triggers. A busy target simply reads as "".
 */
function safeWindowTitle(hwnd: HWND): string {
  const api = win32()
  const buffer = Buffer.alloc(TITLE_MAX_CHARS * 2)
  const result = new Uint32Array(1)
  const ok = api.SendMessageTimeoutW(
    hwnd,
    WM_GETTEXT,
    TITLE_MAX_CHARS,
    buffer,
    SMTO_ABORTIFHUNG,
    TITLE_TIMEOUT_MS,
    result
  )
  return ok ? decodeUtf16(buffer) : ''
}

function describeWindow(hwnd: HWND): NativeWindowInfo {
  const api = win32()
  const { pid, threadId } = readWindowPid(hwnd)
  const classBuffer = Buffer.alloc(512)
  api.GetClassNameW(hwnd, classBuffer, 256)
  return {
    hwnd: hwndHex(hwnd),
    pid,
    threadId,
    className: decodeUtf16(classBuffer),
    title: safeWindowTitle(hwnd),
    visible: api.IsWindowVisible(hwnd),
    hasOwner: hasOwnerWindow(hwnd)
  }
}

/** Serialisable description of one native top-level window. */
export interface NativeWindowInfo {
  /** Handle text, e.g. `0x00a31f2c` (re-obtained on every probe; never cached). */
  hwnd: string
  pid: number
  threadId: number
  /** Win32 class name, e.g. `SunAwtFrame` for AWT/LWJGL game windows. */
  className: string
  title: string
  visible: boolean
  hasOwner: boolean
}

/** All top-level windows of the desktop session (caller filters by pid). */
export function listTopLevelWindows(): NativeWindowInfo[] {
  const windows: NativeWindowInfo[] = []
  win32().EnumWindows((hwnd: HWND) => {
    try {
      windows.push(describeWindow(hwnd))
    } catch {
      // A window vanished between enumeration and inspection: never fatal.
    }
    return true
  }, 0)
  return windows
}

/**
 * Visible, unowned top-level windows owned by `pid`.
 *
 * The tracker polls this every 500 ms while a game runs, so the hot path must
 * never exchange messages with foreign windows: the EnumWindows callback only
 * does pure metadata reads (GetWindowThreadProcessId) and only the few
 * pid-matched windows get described. (Describing the whole desktop used to
 * GetWindowText every window — a synchronous WM_GETTEXT per foreign window,
 * i.e. a deadlock waiting for the game's attached thread once embedded.)
 */
export function listProcessWindows(pid: number): NativeWindowInfo[] {
  const matches: HWND[] = []
  win32().EnumWindows((hwnd: HWND) => {
    if (readWindowPid(hwnd).pid === pid) matches.push(hwnd)
    return true
  }, 0)
  return matches
    .map(describeWindow)
    .filter((window) => window.visible && !window.hasOwner)
}

/**
 * The single window that hosts the game. Anchored on the window CLASS, not
 * just the pid: an AWT/LWJGL game frame is always `SunAwtFrame` (decorated or
 * stripped, parented or not) and a pure-LWJGL display window is `LWJGL`, while
 * pid-only matching picks up anything else the process owns — measured: the
 * Sogou IME injects a visible `SoPY_Status` top-level into the java process,
 * which the tracker then mistook for the game window once the real frame went
 * WS_CHILD (embedded) and left EnumWindows. Within class matches the titled
 * candidate wins (taskbar presence). null = not up yet.
 */
const GAME_WINDOW_CLASSES = new Set(['SunAwtFrame', 'LWJGL'])

export function findGameWindow(pid: number): NativeWindowInfo | null {
  const candidates = listProcessWindows(pid).filter((window) =>
    GAME_WINDOW_CLASSES.has(window.className)
  )
  return candidates.find((window) => window.title !== '') ?? candidates[0] ?? null
}

/**
 * Whether a previously-found handle is still a live window owned by `pid`.
 *
 * `EnumWindows` only yields top-level windows, so once the game window is
 * reparented into the clip container (a WS_CHILD, Phase 3 embedding) it
 * correctly stops appearing there. That is not a lost window — this checks
 * the handle directly so the tracker keeps reporting it as present.
 */
export function isWindowAliveForPid(hwndHex: string, pid: number): boolean {
  const api = win32()
  let hwnd: number
  try {
    hwnd = Number(BigInt(hwndHex))
  } catch {
    return false
  }
  if (!api.IsWindow(hwnd)) return false
  return readWindowPid(hwnd).pid === pid
}

/**
 * Diagnostics: every descendant of `parentHwnd`, in z-order top-first
 * (EnumChildWindows walks the whole subtree). Class names identify who is
 * who — e.g. whether a Chromium render-widget sibling paints over the clip
 * container. Never used on a hot path.
 */
export function listDescendantWindows(parentHwnd: HWND): NativeWindowInfo[] {
  const windows: NativeWindowInfo[] = []
  win32().EnumChildWindows(parentHwnd, (hwnd: HWND) => {
    try {
      windows.push(describeWindow(hwnd))
    } catch {
      // A window vanished mid-enumeration: never fatal.
    }
    return true
  }, 0)
  return windows
}
