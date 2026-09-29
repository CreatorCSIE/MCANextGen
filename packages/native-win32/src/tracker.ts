/**
 * Poll-based lifecycle watcher for the game's native window (Phase 2 task:
 * “detect window creation/destruction”).
 *
 * Why polling instead of `SetWinEventHook`: a WinEvent hook needs a native
 * message pump to deliver callbacks into JS, which would drag a whole event
 * loop design into what is still a detection step. A ~2 s desktop-wide
 * EnumWindows costs sub-millisecond native time; a 500 ms cadence is
 * invisible. Phase 3/4 (embedding, activation sync) can revisit hooks when
 * there is a message loop to attach to anyway.
 */

import {
  findGameWindow,
  isWindowAliveForPid,
  type NativeWindowInfo
} from './windows'

export interface GameWindowTrackerEvents {
  /** Fired when the game window appears (or its handle changes on restart). */
  onFound(window: NativeWindowInfo): void
  /** Fired when a previously found window disappears (closed or process exit). */
  onLost(window: NativeWindowInfo): void
}

export class GameWindowTracker {
  private timer: ReturnType<typeof setInterval> | null = null
  private current: NativeWindowInfo | null = null

  constructor(
    private readonly pid: number,
    private readonly events: GameWindowTrackerEvents,
    private readonly intervalMs = 500
  ) {}

  start(): void {
    if (this.timer !== null) return
    this.poll()
    this.timer = setInterval(() => this.poll(), this.intervalMs)
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.current = null
  }

  /** The window last seen for this pid, or null while none is up. */
  getCurrent(): NativeWindowInfo | null {
    return this.current
  }

  private poll(): void {
    const found = findGameWindow(this.pid)
    if (found) {
      if (found.hwnd !== this.current?.hwnd) {
        // Anti-hijack: while the window we already track is alive, a *new*
        // candidate never steals it — the process can own several look-alike
        // top-level windows over its lifetime (and once the game frame is
        // embedded it leaves EnumWindows, so anything still enumerated is
        // somebody else). Re-fires onFound only after the old handle died.
        if (this.current && isWindowAliveForPid(this.current.hwnd, this.pid)) return
        this.current = found
        this.events.onFound(found)
      }
      return
    }
    if (!this.current) return
    // `EnumWindows` only sees top-level windows, so an embedded (reparented
    // WS_CHILD) game window correctly vanishes from enumeration. That is not
    // a loss — confirm the last handle is still a live, pid-owned window
    // before declaring it gone.
    if (isWindowAliveForPid(this.current.hwnd, this.pid)) return
    const lost = this.current
    this.current = null
    this.events.onLost(lost)
  }
}
