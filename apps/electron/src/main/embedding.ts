/**
 * Electron main-process embedding controller (plan.md Phase 3).
 *
 * Layering (see plan.md "Embedding architecture"): the Electron top-level
 * HWND hosts a WS_CHILD clip container drawn via @mcanextgen/native-win32,
 * and the game window is reparented into that container. The native child
 * always paints above the DOM (windowed overlay); the DOM only reserves and
 * positions the slot and provides the letterbox background.
 *
 * Lifecycle rules encoded here:
 * - The clip is (re)created to follow the renderer-reported slot rect.
 * - `detachEmbedding` runs on the BrowserWindow `close` event — before the
 *   native host window is destroyed — because DestroyWindow tears down the
 *   whole child tree and would otherwise take the game window with it.
 * - When the game process exits on its own the window is already gone, so
 *   only the container is dropped (`dropAfterGameExit`).
 */

import type { BrowserWindow } from 'electron'
import {
  bringWindowOnScreen,
  clearNativeFocus,
  createClipContainer,
  describeWindowGeometry,
  destroyClipContainer,
  embedGameWindow,
  findFocusTargetWithin,
  focusNativeWindow,
  listDescendantWindows,
  moveClipContainer,
  raiseClipContainer,
  resizeEmbeddedGame,
  unembedGameWindow,
  type EmbeddingState
} from '@mcanextgen/native-win32'
import type { MinecraftEmbedBoundsView, MinecraftEmbedView } from '../shared/ipc'

/** What to embed: resolved at launch from registry override / capability probe. */
export interface EmbedSession {
  /** Numeric HWND of the game window (from the tracker's hex handle). */
  gameHwnd: number
  policy: 'fixed' | 'resizable'
  /** fixed: the never-stretched game size in physical px. */
  gameWidth: number
  gameHeight: number
}

interface ActiveEmbedding {
  session: EmbedSession
  clipHwnd: unknown
  embed: EmbeddingState
}

let hostWindow: BrowserWindow | null = null
let session: EmbedSession | null = null
let bounds: MinecraftEmbedBoundsView | null = null
let active: ActiveEmbedding | null = null
let lastError: string | null = null

/** Parses the tracker's `0x…` handle text into the numeric HWND. */
export function hwndToNumber(hex: string): number {
  return Number(BigInt(hex))
}

/**
 * Binds the main window. The `close` hook is the guarantee that the game
 * window is unembedded before its native parent chain is destroyed. The
 * `focus`/`blur` hooks are the two halves of focus forwarding: on focus,
 * keyboard goes to the embedded game's LWJGL window (Chromium would otherwise
 * keep it on the render widget and the parented LWJGL stack would sit deaf —
 * plan.md risk #3, live update 2); on blur, the game's focus is cleared so it
 * gets a real WM_KILLFOCUS (pause menu opens, cursor unclips). Known gap
 * (accepted, live-tested): with Win32 focus living in the attached Java
 * queue, Chromium does not always fire `blur` on Alt+Tab / Win key, so the
 * game may transiently stay focused — a foreground-poll watcher was tried to
 * close this and REVERTED: `GetForegroundWindow` handle comparison misfires
 * and killed all game input, which is far worse than the cosmetic gap.
 */
export function attachMainWindow(win: BrowserWindow): void {
  hostWindow = win
  win.on('close', () => detachEmbedding())
  win.on('focus', () => focusGameInput())
  win.on('blur', () => blurGameInput())
}

function hostHwnd(): number | null {
  if (!hostWindow || hostWindow.isDestroyed()) return null
  const handle = hostWindow.getNativeWindowHandle()
  // The buffer holds an HWND-sized pointer, little-endian (8 bytes on x64).
  return Number(handle.readBigUInt64LE(0))
}

/** Geometry of the game window inside the clip, per policy (physical px). */
function gameRect(s: EmbedSession, area: MinecraftEmbedBoundsView): {
  x: number
  y: number
  width: number
  height: number
} {
  if (s.policy === 'resizable') {
    return { x: 0, y: 0, width: area.width, height: area.height }
  }
  // fixed: never stretched; centred (possibly negative when the slot is
  // smaller than the game — the clip crops, Phase 4 adds the min-size guard).
  return {
    x: Math.round((area.width - s.gameWidth) / 2),
    y: Math.round((area.height - s.gameHeight) / 2),
    width: s.gameWidth,
    height: s.gameHeight
  }
}

/**
 * Diagnostics for the invisible/blank-embedding case: where each window
 * actually ended up (screen rect, parent, style, visibility) plus the host's
 * full child tree in z-order. `tag` distinguishes the initial snapshot from
 * the delayed re-dump.
 */
function dumpEmbedTree(tag: string): void {
  if (!active || !session || !bounds) return
  const parent = hostHwnd()
  if (parent === null) return
  const tree = listDescendantWindows(parent)
    .map((w) => `  ${describeWindowGeometry(Number(BigInt(w.hwnd)))} class=${w.className}`)
    .join('\n')
  console.error(
    `[embed ${tag}] host=${parent} slot=${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}\n` +
      `[embed ${tag}]   ${describeWindowGeometry(active.clipHwnd)}\n` +
      `[embed ${tag}]   ${describeWindowGeometry(session.gameHwnd)}\n` +
      `[embed ${tag}] descendants (z top→bottom):\n${tree}`
  )
}

/** Creates/updates or (when inputs are missing) tears down the embedding. */
function apply(): void {
  if (!session) {
    if (active) {
      try {
        unembedGameWindow(active.embed)
      } catch {
        // The game window may already be gone; the container still must go.
      }
      destroyClipQuietly(active.clipHwnd)
      active = null
    }
    lastError = null
    return
  }
  const parent = hostHwnd()
  if (parent === null || !bounds || bounds.width <= 0 || bounds.height <= 0) return
  try {
    if (!active) {
      const clipHwnd = createClipContainer(parent, bounds.x, bounds.y, bounds.width, bounds.height)
      const rect = gameRect(session, bounds)
      const embed = embedGameWindow(clipHwnd, session.gameHwnd, rect.x, rect.y, rect.width, rect.height)
      active = { session, clipHwnd, embed }
      lastError = null
      // Raise above the sibling render-widget window so the game is not painted
      // over by the DOM (the "windowed overlay" assumption, made explicit).
      raiseClipContainer(clipHwnd)
      dumpEmbedTree('t0')
      // LWJGL creates its GL window during applet.start(), a beat after the
      // AWT frame the tracker first saw. Re-dump once things have settled so a
      // "not yet initialised" snapshot can't be mistaken for the steady state.
      setTimeout(() => dumpEmbedTree('t+2500'), 2500)
      return
    }
    moveClipContainer(active.clipHwnd, bounds.x, bounds.y, bounds.width, bounds.height)
    const rect = gameRect(session, bounds)
    resizeEmbeddedGame(active.embed, rect.x, rect.y, rect.width, rect.height)
    raiseClipContainer(active.clipHwnd)
    lastError = null
  } catch (error) {
    // Degrade gracefully: the game keeps its own top-level window (plan.md
    // "embedding failure falls back to windowed"), the failure surfaces in UI.
    lastError = error instanceof Error ? error.message : String(error)
    if (active) {
      try {
        unembedGameWindow(active.embed)
      } catch {
        // ignore — falling back after a partial embed
      }
      destroyClipQuietly(active.clipHwnd)
      active = null
    } else {
      // Clip may have been created before the embed failed.
      // Nothing else to reclaim: createClipContainer throws only on failure.
    }
    // The Java host parked the frame off-screen (at -32000,-32000) expecting
    // us to dock it. Embedding failed, so rescue it back on-screen or the game
    // runs invisibly. Only relevant for a top-level (unembedded) frame now.
    try {
      bringWindowOnScreen(session.gameHwnd)
    } catch {
      // Window may already be gone; nothing else to try.
    }
  }
}

function destroyClipQuietly(clipHwnd: unknown): void {
  try {
    destroyClipContainer(clipHwnd)
  } catch {
    // Already gone (host window destroyed under it).
  }
}

/** The tracker found the game window: start embedding it (if policy allows). */
export function beginEmbedding(next: EmbedSession): void {
  session = next
  apply()
}

/** The game window disappeared while the process lives: drop the container. */
export function endEmbedding(): void {
  session = null
  if (active) {
    // The tracker only reports a loss once the game handle is dead, so there
    // is nothing to unembed — but the orphaned clip container must go, or it
    // stays as a dead child over the slot.
    destroyClipQuietly(active.clipHwnd)
  }
  active = null
  lastError = null
}

/** Renderer reported the slot rect (physical px, client coordinates). */
export function setEmbedBounds(next: MinecraftEmbedBoundsView): void {
  bounds = next
  apply()
}

/**
 * Focus forwarding: hand Win32 keyboard focus to the embedded game's LWJGL
 * child window. The parented LWJGL display reads keys from that HWND's own
 * wndproc and `Mouse.setGrabbed` only works while it holds focus — inside the
 * embedding, neither AWT nor Chromium ever puts it there on their own after a
 * focus round-trip (the Java `parent_focused` tracker stays false because the
 * reparented frame never regains activation through AWT's focus manager).
 * Best-effort: no embedding → no-op; window vanished → swallowed.
 */
export function focusGameInput(): void {
  if (!active || !session) return
  try {
    focusNativeWindow(findFocusTargetWithin(session.gameHwnd))
  } catch {
    // The game window vanished mid-call; the tracker converges next poll.
  }
}

/**
 * Blur counterpart: when the host window loses activation, pull Win32 focus
 * off the game so it receives a real WM_KILLFOCUS. Without this the embedded
 * game stays falsely focused — no pause menu on Alt+Tab away, and the cursor
 * stays clipped over the whole desktop. A no-op when the game did not hold
 * focus (SetFocus(NULL) then finds nothing to unfocus). Best-effort.
 */
export function blurGameInput(): void {
  if (!active || !session) return
  try {
    clearNativeFocus(findFocusTargetWithin(session.gameHwnd))
  } catch {
    // The game window vanished mid-call; nothing left to unfocus.
  }
}

/**
 * Full teardown with the game window still alive (app quit / window close):
 * unembed first so the AWT frame returns to a top-level window, then destroy
 * the container. Safe to call when nothing is embedded.
 */
export function detachEmbedding(): void {
  if (active) {
    try {
      unembedGameWindow(active.embed)
    } catch {
      // The game window vanished concurrently; the container cleanup below
      // must still run.
    }
    destroyClipQuietly(active.clipHwnd)
  }
  active = null
  session = null
  lastError = null
}

/**
 * The game process exited (its window is already gone): just drop the
 * container — no unembed to undo, no styles to restore.
 */
export function dropAfterGameExit(): void {
  if (active) destroyClipQuietly(active.clipHwnd)
  active = null
  session = null
  lastError = null
}

export function isEmbeddingActive(): boolean {
  return active !== null
}

export function getEmbedError(): string | null {
  return lastError
}

/** The session policy for renderer layout (null while no launch decided). */
export function getEmbedView(): MinecraftEmbedView | null {
  if (!session) return null
  return {
    policy: session.policy,
    gameWidth: session.gameWidth,
    gameHeight: session.gameHeight
  }
}
