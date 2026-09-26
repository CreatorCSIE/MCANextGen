/**
 * Launches the legacy Minecraft runtime as a separate Java 8 process.
 *
 * The command line mirrors what the standalone smoke test proved out:
 *
 *   java <java_arguments + fix_arguments, see arguments.ts>
 *        -cp mcanextgen-host.jar
 *        -Dmcanextgen.jars=<client;lwjgl;lwjgl_util;jinput>
 *        -Dmcanextgen.appletClass=<applet entry>
 *        -Dmcanextgen.params=<temp json file with the applet parameters>
 *        -Dmcanextgen.width/-Dmcanextgen.height/-Dmcanextgen.title
 *        -Dorg.lwjgl.librarypath=<natives dir>
 *        -Dnet.java.games.input.librarypath=<natives dir>
 *        org.mcanextgen.host.MinecraftHost
 *
 * Phase 1 explicitly allows the game window to be a separate top-level window;
 * capturing/embedding its native handle is Phase 2/3 work.
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { MinecraftLayout } from './layout'
import { missingMinecraftAssets } from './layout'
import { DEFAULT_GAME_JVM_ARGUMENTS } from './arguments'
import type { MinecraftVersion } from './version'

export interface MinecraftLaunchOptions {
  /** Absolute path of a probed Java 8 `java` executable. */
  javaExecutable: string
  /** Filesystem layout to launch from (see layout.ts). */
  layout: MinecraftLayout
  version: MinecraftVersion
  /** Directory the game process runs in; classic clients write levels relative to it. */
  cwd?: string
  /** Window title reported by the Java host frame. */
  title?: string
  /** Override the version's default width/height. */
  width?: number
  height?: number
  /**
   * JVM argument group; defaults to `DEFAULT_GAME_JVM_ARGUMENTS`
   * (the ported java_arguments + fix_arguments, see arguments.ts).
   */
  jvmArguments?: readonly string[]
}

export interface MinecraftExitInfo {
  code: number | null
  signal: NodeJS.Signals | null
}

export interface MinecraftGame {
  readonly versionId: string
  readonly pid: number
  running(): boolean
  exitInfo(): MinecraftExitInfo | null
  /** Last lines of the game process output, for diagnostics. */
  tail(): string[]
  onExit(listener: (info: MinecraftExitInfo) => void): void
  /** Asks the JVM to exit (kills the process on Windows until graceful shutdown lands). */
  stop(): void
}

export class MinecraftLaunchError extends Error {
  readonly missingPaths: string[]

  constructor(message: string, missingPaths: string[] = []) {
    super(message)
    this.name = 'MinecraftLaunchError'
    this.missingPaths = missingPaths
  }
}

const MAX_TAIL_LINES = 60

/** Launch Minecraft; resolves once the Java process exists, not once the game window is up. */
export async function launchMinecraft(options: MinecraftLaunchOptions): Promise<MinecraftGame> {
  const { javaExecutable, layout, version } = options

  const missing = missingMinecraftAssets(layout)
  if (missing.length > 0) {
    throw new MinecraftLaunchError(
      `Missing Minecraft assets:\n${missing.map((file) => `  ${file}`).join('\n')}`,
      missing
    )
  }

  const parameters: Record<string, string> = {
    username: 'Player',
    sessionid: String(Math.floor(Math.random() * 1_000_000_000)),
    ...version.parameters
  }
  const paramsDir = mkdtempSync(path.join(tmpdir(), 'mcanextgen-'))
  const paramsFile = path.join(paramsDir, 'params.json')
  writeFileSync(paramsFile, JSON.stringify(parameters), 'utf8')

  const hostMainClass = 'org.mcanextgen.host.MinecraftHost'
  const jvmArguments = options.jvmArguments ?? DEFAULT_GAME_JVM_ARGUMENTS
  const args = [
    ...jvmArguments,
    `-Dorg.lwjgl.librarypath=${layout.nativesDir}`,
    `-Dnet.java.games.input.librarypath=${layout.nativesDir}`,
    `-Dmcanextgen.jars=${[layout.clientJar, ...layout.lwjglJars].join(path.delimiter)}`,
    `-Dmcanextgen.appletClass=${version.appletClass}`,
    `-Dmcanextgen.params=${paramsFile}`,
    `-Dmcanextgen.width=${options.width ?? version.width}`,
    `-Dmcanextgen.height=${options.height ?? version.height}`,
    `-Dmcanextgen.title=${options.title ?? 'Minecraft'}`,
    '-cp',
    layout.hostJar,
    hostMainClass
  ]

  const child = spawn(javaExecutable, args, {
    cwd: options.cwd ?? path.dirname(layout.clientJar),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const tail: string[] = []
  const pushTail = (chunk: Buffer | string): void => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim() === '') continue
      tail.push(line)
      if (tail.length > MAX_TAIL_LINES) tail.shift()
    }
  }
  child.stdout?.on('data', (chunk: Buffer) => pushTail(chunk))
  child.stderr?.on('data', (chunk: Buffer) => pushTail(chunk))

  let exitInfo: MinecraftExitInfo | null = null
  const listeners: ((info: MinecraftExitInfo) => void)[] = []
  child.on('exit', (code, signal) => {
    exitInfo = { code, signal }
    for (const listener of listeners.splice(0)) listener(exitInfo)
  })

  const spawnFailure = await new Promise<Error | null>((resolve) => {
    child.once('spawn', () => resolve(null))
    child.once('error', (error) => resolve(error))
  })
  if (spawnFailure) {
    throw new MinecraftLaunchError(
      `Failed to start "${javaExecutable}": ${spawnFailure.message}`
    )
  }

  if (child.pid === undefined) {
    throw new MinecraftLaunchError('Java process started without a pid')
  }

  const pid = child.pid
  return {
    versionId: version.id,
    pid,
    running: () => exitInfo === null,
    exitInfo: () => exitInfo,
    tail: () => [...tail],
    onExit: (listener) => {
      if (exitInfo) listener(exitInfo)
      else listeners.push(listener)
    },
    stop: () => {
      if (exitInfo === null) child.kill()
    }
  }
}
