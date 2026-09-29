/**
 * @mcanextgen/native-win32 — Win32 native window capture and embedding for
 * MCANextGen.
 *
 * Phase 2: find and track the Minecraft game window by owning process.
 * Phase 3: clip container + reparenting (embedder.ts) for the Electron
 * Edition; no other edition is expected to consume this package (window
 * embedding is Windows-specific; Phase 9/10 land Linux/macOS equivalents).
 */

export { GameWindowTracker, type GameWindowTrackerEvents } from './tracker'
export {
  findGameWindow,
  listProcessWindows,
  listTopLevelWindows,
  listDescendantWindows,
  type NativeWindowInfo
} from './windows'
export {
  createClipContainer,
  raiseClipContainer,
  moveClipContainer,
  embedGameWindow,
  resizeEmbeddedGame,
  unembedGameWindow,
  bringWindowOnScreen,
  destroyClipContainer,
  readClientRect,
  describeWindowGeometry,
  findFocusTargetWithin,
  focusNativeWindow,
  clearNativeFocus,
  pumpMessages,
  type EmbeddingState
} from './embedder'

/** True when native window capture is available (only Windows is implemented). */
export function supportsNativeWindowCapture(): boolean {
  return process.platform === 'win32'
}
