/**
 * @mcanextgen/native-win32 — Win32 native window capture for MCANextGen.
 *
 * Phase 2 scope: find and track the Minecraft game window by owning process.
 * Phase 3 (style mutation + reparenting) will extend this package; the
 * Electron Edition consumes it, and no other edition is expected to (window
 * embedding is Windows-specific; Phase 9/10 land Linux/macOS equivalents).
 */

export { GameWindowTracker, type GameWindowTrackerEvents } from './tracker'
export {
  findGameWindow,
  listProcessWindows,
  listTopLevelWindows,
  type NativeWindowInfo
} from './windows'

/** True when native window capture is available (only Windows is implemented). */
export function supportsNativeWindowCapture(): boolean {
  return process.platform === 'win32'
}
