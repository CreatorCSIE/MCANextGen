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
import type { MinecraftFix, MinecraftVersion } from './version'
import { appletWindowTitle } from './applets'

export interface MinecraftLaunchOptions {
  /** Absolute path of a probed Java 8 `java` executable. */
  javaExecutable: string
  /** Filesystem layout to launch from (see layout.ts). */
  layout: MinecraftLayout
  version: MinecraftVersion
  /**
   * Override the registry's applet entry class — e.g. picking
   * `net.minecraft.isom.IsomPreviewApplet` inside an infdev 20100617 jar
   * (see applets.ts; this is why no separate isom channel/folder exists).
   */
  appletClass?: string
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
  /** Forwarded for every stdout/stderr line of the game process (host logs, patches, crashes). */
  onOutput?: (line: string) => void
  /**
   * Extra applet parameters merged over the version defaults — e.g. `server`
   * and `port` make the 15a patch connect to a classic multiplayer server
   * instead of starting singleplayer.
   */
  extraParameters?: Record<string, string>
  /**
   * Optional-feature switches for this launch. Omitted = the version
   * registry's `defaultEnabled` set; provided = exactly these fixes run
   * (the UI passes the checked list so users can toggle patches per launch).
   */
  fixesEnabled?: readonly MinecraftFix[]
  /**
   * Phase 3 embedding: the host will reparent the game window into a clip
   * container, so the Java frame parks itself off-screen at startup (the
   * frame stays DECORATED — an undecorated SunAwtFrame breaks LWJGL2's
   * parented mode; decorations are stripped natively at embed time). Only set
   * when the host can actually embed the window (native capture available).
   */
  embedded?: boolean
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

/** Drop blank/whitespace-only UI inputs so absent fields behave as "unset". */
function cleanParameters(
  parameters: Record<string, string> | undefined
): Record<string, string> {
  const cleaned: Record<string, string> = {}
  for (const [key, value] of Object.entries(parameters ?? {})) {
    if (value.trim() !== '') cleaned[key] = value.trim()
  }
  return cleaned
}

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
    ...version.parameters,
    ...cleanParameters(options.extraParameters)
  }
  // Same parameter names the browser-era <embed> used, so the host and any
  // game-side readers agree on the switch (see version.ts MinecraftFix).
  const fixes = version.fixes ?? []
  const enabledFixes = options.fixesEnabled
    ? fixes.filter((fix) => options.fixesEnabled?.includes(fix.kind))
    : fixes.filter((fix) => fix.defaultEnabled)
  for (const fix of enabledFixes) parameters[fix.kind] = 'true'
  const paramsDir = mkdtempSync(path.join(tmpdir(), 'mcanextgen-'))
  const paramsFile = path.join(paramsDir, 'params.json')
  writeFileSync(paramsFile, JSON.stringify(parameters), 'utf8')

  const hostMainClass = 'org.mcanextgen.host.MinecraftHost'
  const jvmArguments = options.jvmArguments ?? DEFAULT_GAME_JVM_ARGUMENTS
  const entryAppletClass = options.appletClass ?? version.appletClass
  const args = [
    ...jvmArguments,
    `-Dorg.lwjgl.librarypath=${layout.nativesDir}`,
    `-Dnet.java.games.input.librarypath=${layout.nativesDir}`,
    `-Dmcanextgen.jars=${[layout.clientJar, ...layout.lwjglJars].join(path.delimiter)}`,
    `-Dmcanextgen.appletClass=${entryAppletClass}`,
    `-Dmcanextgen.params=${paramsFile}`,
    `-Dmcanextgen.width=${options.width ?? version.width}`,
    `-Dmcanextgen.height=${options.height ?? version.height}`,
    // Alternate entry classes are separate programs (e.g. the isom preview);
    // they get their own window title instead of sharing "Minecraft".
    `-Dmcanextgen.title=${options.title ?? appletWindowTitle(entryAppletClass) ?? 'Minecraft'}`,
    ...(options.embedded ? ['-Dmcanextgen.embed=true'] : []),
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
      options.onOutput?.(line)
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
