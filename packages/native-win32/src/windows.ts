/**
 * Enumerate top-level windows and identify the Minecraft game window by its
 * process id (Phase 2: “detect by process, not by title”).
 *
 * The owning-PID check (`GetWindowThreadProcessId`) is the authoritative
 * filter; class name and title are only *reported*, never required. This is
 * what the plan asks for — window-title-only detection breaks the moment two
 * games or a rename are involved, and the isom preview even uses its own
 * title (see appletWindowTitle). `EnumWindows` only yields top-level windows,
 * so child windows never appear; the extra filters keep invisible helper and
 * owned tool windows out of the candidate set.
 */

import { decodeUtf16, hasOwnerWindow, hwndHex, readWindowPid, win32, type HWND } from './win32'

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

function describeWindow(hwnd: HWND): NativeWindowInfo {
  const api = win32()
  const { pid, threadId } = readWindowPid(hwnd)
  const classBuffer = Buffer.alloc(512)
  api.GetClassNameW(hwnd, classBuffer, 256)
  const titleLength = api.GetWindowTextLengthW(hwnd)
  const titleBuffer = Buffer.alloc((titleLength + 1) * 2)
  api.GetWindowTextW(hwnd, titleBuffer, titleLength + 1)
  return {
    hwnd: hwndHex(hwnd),
    pid,
    threadId,
    className: decodeUtf16(classBuffer),
    title: decodeUtf16(titleBuffer),
    visible: api.IsWindowVisible(hwnd),
    hasOwner: hasOwnerWindow(hwnd)
  }
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

/** Visible, unowned top-level windows owned by `pid`. */
export function listProcessWindows(pid: number): NativeWindowInfo[] {
  return listTopLevelWindows().filter(
    (window) => window.pid === pid && window.visible && !window.hasOwner
  )
}

/**
 * The single window that hosts the game: first process-owned candidate that
 * carries a title (an AWT frame with a taskbar presence). null = not up yet.
 */
export function findGameWindow(pid: number): NativeWindowInfo | null {
  const candidates = listProcessWindows(pid)
  return candidates.find((window) => window.title !== '') ?? candidates[0] ?? null
}
