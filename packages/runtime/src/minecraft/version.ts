/**
 * Registry of Minecraft versions MCANextGen knows how to host.
 *
 * Client jars are never distributed: they live in `assets/minecraft/<channel>/`
 * (see plan.md, "Minecraft client location") and a missing jar is reported with
 * the full path the host expected.
 */

export type MinecraftChannel =
  | 'classic'
  | 'indev'
  | 'infdev'
  | 'alpha'
  | 'beta'
  | 'release'
  | 'isom'

export interface MinecraftVersion {
  /** Unique id, also used as the UI key, e.g. `c0.0.21a_01`. */
  id: string
  channel: MinecraftChannel
  /** Jar path relative to the repository root, e.g. `assets/minecraft/classic/c0.0.21a_01.jar`. */
  jar: string
  /**
   * Applet entry class loaded by the Java host (plan.md 18.6.2).
   * 0.0.21a_01 exposes `com.mojang.minecraft.MinecraftApplet`; the game body itself
   * is the obfuscated `com.mojang.minecraft.d`, reached only through the applet.
   */
  appletClass: string
  /**
   * Applet parameters (`getParameter` on the Stub, see plan.md 18.6.1).
   * Values are plain strings; `username`/`sessionid` get defaults at launch time.
   */
  parameters: Record<string, string>
  width: number
  height: number
}

export const CLASSIC_C0_0_21A_01: MinecraftVersion = {
  id: 'c0.0.21a_01',
  channel: 'classic',
  jar: 'assets/minecraft/classic/c0.0.21a_01.jar',
  appletClass: 'com.mojang.minecraft.MinecraftApplet',
  parameters: {},
  width: 854,
  height: 480
}

export const KNOWN_VERSIONS: readonly MinecraftVersion[] = [CLASSIC_C0_0_21A_01]

export function getMinecraftVersion(id: string): MinecraftVersion {
  const version = KNOWN_VERSIONS.find((entry) => entry.id === id)
  if (!version) {
    throw new Error(
      `Unknown Minecraft version "${id}"; known: ${KNOWN_VERSIONS.map((v) => v.id).join(', ')}`
    )
  }
  return version
}
