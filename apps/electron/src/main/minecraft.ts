/**
 * Main-process view of a Minecraft game session: launches the game through
 * the runtime layer, keeps a single running session and maps it to a
 * serialisable `MinecraftStateView` for the renderer.
 */

import path from 'node:path'
import { app } from 'electron'
import {
  detectEntryCapabilities,
  detectJavaRuntime,
  getMinecraftVersion,
  KNOWN_VERSIONS,
  launchMinecraft,
  listAppletClasses,
  MinecraftLaunchError,
  resolveMinecraftLayout,
  type MinecraftGame,
  type MinecraftLayout
} from '@mcanextgen/runtime'
import {
  GameWindowTracker,
  supportsNativeWindowCapture,
  type NativeWindowInfo
} from '@mcanextgen/native-win32'
import {
  beginEmbedding,
  detachEmbedding,
  dropAfterGameExit,
  endEmbedding,
  getEmbedError,
  hwndToNumber,
  isEmbeddingActive,
  setEmbedBounds
} from './embedding'
import type {
  MinecraftAppletList,
  MinecraftEmbedBoundsView,
  MinecraftEmbedView,
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

/**
 * Embedding policy for the current session, resolved at launch from the
 * registry override / capability probe (see runtime capabilities.ts). The
 * renderer lays its slot out from this even before the game window appears;
 * `beginEmbedding` only runs once the tracker actually finds the window.
 */
let sessionEmbedView: MinecraftEmbedView | null = null

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
      if (sessionEmbedView) {
        beginEmbedding({ gameHwnd: hwndToNumber(window.hwnd), ...sessionEmbedView })
      }
    },
    onLost: () => {
      detectedWindow = null
      endEmbedding()
    }
  })
  windowTracker.start()
}

function buildWindowView(running: boolean, pid: number | null): MinecraftWindowView {
  const supported = supportsNativeWindowCapture()
  const base = {
    supported,
    hwnd: null,
    pid,
    className: null,
    title: null,
    embedded: isEmbeddingActive(),
    embedError: getEmbedError()
  }
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
    window: buildWindowView(running, game?.pid ?? null),
    embed: sessionEmbedView
  }
}

/**
 * Embedding policy for one launch: the registry override wins, otherwise the
 * offline capability probe decides (`resizable` only when the game loop
 * actually polls the canvas size — see runtime capabilities.ts). The probe
 * reads class files in-process; if anything about the jar goes wrong we fall
 * back to `fixed`, which is the safe layout (never stretched, clip-cropped).
 */
function resolveEmbedView(
  layout: MinecraftLayout,
  version: { resizePolicy?: 'fixed' | 'resizable'; width: number; height: number },
  entryClass: string
): MinecraftEmbedView {
  let resizable = false
  try {
    resizable = detectEntryCapabilities(layout, entryClass).resizable
  } catch {
    resizable = false
  }
  return {
    policy: version.resizePolicy ?? (resizable ? 'resizable' : 'fixed'),
    gameWidth: version.width,
    gameHeight: version.height
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
      appletClass: options?.appletClass ?? undefined,
      // Embedding policy for the Java host's *startup* position. When native
      // capture is available the host takes over the window, so the Java frame
      // parks itself off-screen to avoid the top-left flash + □× caption residue
      // while docking. The frame still starts DECORATED (an undecorated
      // SunAwtFrame breaks LWJGL2's parented mode — plan.md risk #4 reversal);
      // decorations are stripped natively at embed time, which the pure-native
      // PoC proved stable for AWT peers (the style never revives).
      embedded: supportsNativeWindowCapture(),
      onOutput: (line) => console.error(`[java ${version.id}] ${line}`)
    })
    // Decide the embedding policy before tracking starts: the probe is
    // offline (bytecode), so this never waits on the JVM. Computed on the
    // entry the game will actually run (panel override or registry default).
    sessionEmbedView = resolveEmbedView(
      layout,
      version,
      options?.appletClass ?? version.appletClass
    )
    startWindowTracking(game)
    game.onExit(() => {
      // The process (and its window) is gone; drop the container (the game
      // HWND vanished with it, so there is nothing to unembed) and stop
      // watching, but keep the finished session around so the panel can show
      // pid/exit code until the next launch.
      dropAfterGameExit()
      sessionEmbedView = null
      resetWindowTracking()
    })
  } catch (error) {
    game = null
    sessionEmbedView = null
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
  // Unembed while the game window is still alive: the frame returns to a
  // decorated top-level before the process is killed (teardown hard rule).
  detachEmbedding()
  sessionEmbedView = null
  game?.stop()
  return toView()
}

export function getMinecraftStatusView(): MinecraftStateView {
  return toView()
}

/**
 * Renderer reported the embedding slot's rect (physical px, client coords);
 * main positions the clip container and the game window inside it to match.
 */
export function setMinecraftEmbedBoundsView(
  bounds: MinecraftEmbedBoundsView
): MinecraftStateView {
  setEmbedBounds(bounds)
  return toView()
}

/**
 * Terminates the game when the host quits: detach the embedding first (the
 * BrowserWindow's own `close` hook covers window destruction; this is the
 * before-quit path), then stop the child process.
 */
export function shutdownMinecraft(): void {
  detachEmbedding()
  resetWindowTracking()
  game?.stop()
}
