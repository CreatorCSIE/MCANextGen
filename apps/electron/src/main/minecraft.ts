/**
 * Main-process view of a Minecraft game session: launches the game through
 * the runtime layer, keeps a single running session and maps it to a
 * serialisable `MinecraftStateView` for the renderer.
 */

import path from 'node:path'
import { app } from 'electron'
import {
  detectJavaRuntime,
  KNOWN_VERSIONS,
  launchMinecraft,
  MinecraftLaunchError,
  resolveMinecraftLayout,
  getMinecraftVersion,
  type MinecraftGame
} from '@mcanextgen/runtime'
import type {
  MinecraftLaunchOptionsView,
  MinecraftStateView,
  MinecraftVersionOptionView
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

function toView(): MinecraftStateView {
  const exit = game?.exitInfo() ?? null
  return {
    running: game?.running() ?? false,
    versionId: game?.versionId ?? null,
    pid: game?.pid ?? null,
    exitCode: exit?.code ?? null,
    exitSignal: exit?.signal ?? null,
    error: lastError
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
      extraParameters: options?.extraParameters ?? undefined
    })
    game.onExit(() => {
      // Keep the finished session around so the panel can show pid/exit code
      // until the next launch.
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
  game?.stop()
}
