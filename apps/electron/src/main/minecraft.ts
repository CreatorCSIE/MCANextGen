/**
 * Main-process view of a Minecraft game session: launches the game through
 * the runtime layer, keeps a single running session and maps it to a
 * serialisable `MinecraftStateView` for the renderer.
 */

import path from 'node:path'
import { app } from 'electron'
import {
  detectJavaRuntime,
  getMinecraftVersion,
  KNOWN_VERSIONS,
  launchMinecraft,
  listAppletClasses,
  MinecraftLaunchError,
  resolveMinecraftLayout,
  type MinecraftGame
} from '@mcanextgen/runtime'
import {
  GameWindowTracker,
  supportsNativeWindowCapture,
  type NativeWindowInfo
} from '@mcanextgen/native-win32'
import type {
  MinecraftAppletList,
  MinecraftLaunchOptionsView,
  MinecraftStateView,
  MinecraftVersionOptionView,
  MinecraftWindowView
} from '../shared/ipc'

/**
 * Repository root, used to locate `assets/` and the built host jar.
 * dev/preview: appPath is apps/electron; packaged: resources/app.asar
 * (assets unpack next to it) — embedding-time packaging lands in Phase 4.
 */
function repoRoot(): string {
  return app.isPackaged
    ? path.resolve(app.getAppPath(), '..')
    : path.resolve(app.getAppPath(), '..', '..')
}

let game: MinecraftGame | null = null
let lastError: string | null = null

/* --- Native window tracking (Phase 2: detect the game window by owning pid) --- */

let windowTracker: GameWindowTracker | null = null
let detectedWindow: NativeWindowInfo | null = null
let windowSeen = false

function resetWindowTracking(): void {
  windowTracker?.stop()
  windowTracker = null
  detectedWindow = null
  windowSeen = false
}

function startWindowTracking(session: MinecraftGame): void {
  resetWindowTracking()
  if (!supportsNativeWindowCapture()) return
  windowTracker = new GameWindowTracker(session.pid, {
    onFound: (window) => {
      detectedWindow = window
      windowSeen = true
    },
    onLost: () => {
      detectedWindow = null
    }
  })
  windowTracker.start()
}

function buildWindowView(running: boolean, pid: number | null): MinecraftWindowView {
  const supported = supportsNativeWindowCapture()
  const base = { supported, hwnd: null, pid, className: null, title: null }
  if (!supported || !running || !pid) return { ...base, state: 'none' }
  if (detectedWindow) {
    return {
      ...base,
      state: 'found',
      hwnd: detectedWindow.hwnd,
      className: detectedWindow.className,
      title: detectedWindow.title
    }
  }
  // AWT/LWJGL takes a moment from process start to frame creation.
  if (!windowSeen) return { ...base, state: 'pending' }
  // A window was up and disappeared while the process is still alive.
  return { ...base, state: 'lost' }
}

function toView(): MinecraftStateView {
  const exit = game?.exitInfo() ?? null
  const running = game?.running() ?? false
  return {
    running,
    versionId: game?.versionId ?? null,
    pid: game?.pid ?? null,
    exitCode: exit?.code ?? null,
    exitSignal: exit?.signal ?? null,
    error: lastError,
    window: buildWindowView(running, game?.pid ?? null)
  }
}

export function listMinecraftVersionsView(): MinecraftVersionOptionView[] {
  return KNOWN_VERSIONS.map((version) => ({
    id: version.id,
    label: version.label,
    fixes: (version.fixes ?? []).map((fix) => ({
      kind: fix.kind,
      label: fix.label,
      defaultEnabled: fix.defaultEnabled
    })),
    supportsMultiplayer: version.supportsMultiplayer ?? false
  }))
}

/**
 * Offline scan of the version's client jar for launchable Applet entry
 * classes (infdev 20100617 carries the isom preview next to the regular
 * client). The scan parses class files in-process (see runtime applets.ts):
 * no JVM, no Java dependency. Failures degrade to "default only" so the
 * panel never blocks on an exotic or missing jar. Successful results are
 * memoized per version to skip re-reading unchanged jars.
 */
const appletScanCache = new Map<string, MinecraftAppletList>()

export async function listMinecraftAppletsView(versionId: string): Promise<MinecraftAppletList> {
  const cached = appletScanCache.get(versionId)
  if (cached) return cached
  const fallback = (error: string): MinecraftAppletList => ({
    appletClasses: [],
    defaultAppletClass: getMinecraftVersion(versionId).appletClass,
    error
  })
  try {
    const version = getMinecraftVersion(versionId)
    const layout = resolveMinecraftLayout(repoRoot(), version)
    const scan = listAppletClasses(layout)
    const result: MinecraftAppletList = {
      appletClasses: scan.appletClasses,
      defaultAppletClass: version.appletClass,
      error: null
    }
    appletScanCache.set(versionId, result)
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return fallback(message)
  }
}

export async function launchMinecraftView(
  versionId: string,
  options?: MinecraftLaunchOptionsView
): Promise<MinecraftStateView> {
  lastError = null
  if (game?.running()) {
    lastError = 'A game session is already running; stop it before launching another one'
    return toView()
  }

  try {
    const version = getMinecraftVersion(versionId)
    const layout = resolveMinecraftLayout(repoRoot(), version)
    const report = await detectJavaRuntime()
    if (!report.selection.installation) {
      lastError = report.selection.reason
      return toView()
    }

    game = await launchMinecraft({
      javaExecutable: report.selection.installation.executable,
      layout,
      version,
      // The panel always sends its full checkbox state; an empty list means
      // "all optional patches off", so it must not degrade to the registry
      // default (undefined).
      fixesEnabled: options?.fixesEnabled ?? undefined,
      extraParameters: options?.extraParameters ?? undefined,
      appletClass: options?.appletClass ?? undefined
    })
    startWindowTracking(game)
    game.onExit(() => {
      // The process (and its window) is gone; stop watching but keep the
      // finished session around so the panel can show pid/exit code until
      // the next launch.
      resetWindowTracking()
    })
  } catch (error) {
    game = null
    lastError =
      error instanceof MinecraftLaunchError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error)
  }
  return toView()
}

export function stopMinecraftView(): MinecraftStateView {
  game?.stop()
  return toView()
}

export function getMinecraftStatusView(): MinecraftStateView {
  return toView()
}

/** Terminates the game when the host quits (Phase 1: game is a child process). */
export function shutdownMinecraft(): void {
  resetWindowTracking()
  game?.stop()
}
