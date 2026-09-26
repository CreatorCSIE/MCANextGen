/**
 * Filesystem layout of the runtime assets (see plan.md "Minecraft client location"
 * and Phase 8). Unlike `assets/minecraft/`, the LWJGL tree is distributed with the
 * repository, so a clean checkout only misses client jars.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import type { MinecraftVersion } from './version'

/** LWJGL 2 release vendored under `assets/lwjgl/`. */
export const LWJGL_VERSION = '2.9.3'

/** Java-side bootstrap jar produced by `runtime/minecraft-host/build.ps1`. */
export const HOST_JAR_PATH = 'runtime/minecraft-host/build/mcanextgen-host.jar'

const LWJGL_JARS = ['lwjgl.jar', 'lwjgl_util.jar', 'jinput.jar']

export interface MinecraftLayout {
  /** Absolute path of the vendored host bootstrap jar. */
  hostJar: string
  /** Absolute path of the client jar, whether or not the user provided it. */
  clientJar: string
  /** lwjgl.jar / lwjgl_util.jar / jinput.jar. */
  lwjglJars: string[]
  /** Directory holding the unpacked platform natives (lwjgl.dll, OpenAL32.dll, …). */
  nativesDir: string
}

function nativesPlatform(platform: NodeJS.Platform): string {
  switch (platform) {
    case 'win32':
      return 'windows'
    default:
      // Phase 9 adds linux/macos natives; fail with the convention instead of guessing.
      throw new Error(`no LWJGL natives vendored for platform "${platform}"`)
  }
}

export function resolveMinecraftLayout(
  rootDir: string,
  version: MinecraftVersion,
  platform: NodeJS.Platform = process.platform
): MinecraftLayout {
  const lwjglDir = path.join(rootDir, 'assets', 'lwjgl', LWJGL_VERSION)
  return {
    hostJar: path.join(rootDir, ...HOST_JAR_PATH.split('/')),
    clientJar: path.join(rootDir, ...version.jar.split('/')),
    lwjglJars: LWJGL_JARS.map((jar) => path.join(lwjglDir, jar)),
    nativesDir: path.join(lwjglDir, 'natives', nativesPlatform(platform))
  }
}

/** Absolute paths the launch needs but that do not exist yet. */
export function missingMinecraftAssets(layout: MinecraftLayout): string[] {
  const required = [layout.hostJar, layout.clientJar, ...layout.lwjglJars]
  const missing = required.filter((file) => !existsSync(file))
  if (!existsSync(layout.nativesDir)) missing.push(layout.nativesDir)
  return missing
}
