/**
 * Main-process view over the runtime launch layer: owns the single game
 * session and maps it to the serialisable `MinecraftStateView` contract.
 */

import { app } from 'electron'
import path from 'node:path'
import {
  detectJavaRuntime,
  getMinecraftVersion,
  launchMinecraft,
  resolveMinecraftLayout,
  type MinecraftGame
} from '@mcanextgen/runtime'
import type { MinecraftStateView } from '../shared/ipc'

let game: MinecraftGame | null = null
let lastError: string | null = null

/** Repository root in dev and preview alike: apps/electron -> ../.. */
function repoRoot(): string {
  return path.resolve(app.getAppPath(), '..', '..')
}

function statusView(): MinecraftStateView {
  if (!game) {
    return {
      running: false,
      versionId: null,
      pid: null,
      exitCode: null,
      exitSignal: null,
      error: lastError
    }
  }
  const exit = game.exitInfo()
  return {
    running: game.running(),
    versionId: game.versionId,
    pid: game.pid,
    exitCode: exit?.code ?? null,
    exitSignal: exit?.signal ?? null,
    error: lastError
  }
}

export async function launchMinecraftView(versionId: string): Promise<MinecraftStateView> {
  if (game?.running()) return statusView()
  lastError = null
  try {
    const version = getMinecraftVersion(versionId)
    const report = await detectJavaRuntime()
    const installation = report.selection.installation
    if (!installation) {
      throw new Error(`Java ${report.requiredMajor} is not available: ${report.selection.reason}`)
    }
    const layout = resolveMinecraftLayout(repoRoot(), version)
    game = await launchMinecraft({ javaExecutable: installation.executable, layout, version })
    console.log(
      `[minecraft] launched ${version.id} (pid ${game.pid}) with ${installation.raw} (${installation.architecture})`
    )
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error)
    console.error('[minecraft] launch failed:', error)
    game = null
  }
  return statusView()
}

export function stopMinecraftView(): MinecraftStateView {
  game?.stop()
  return statusView()
}

export function minecraftStatusView(): MinecraftStateView {
  return statusView()
}

/** Host shutdown must not orphan the game process. */
export function shutdownMinecraft(): void {
  game?.stop()
}
