/**
 * Registry of Minecraft versions MCANextGen knows how to host.
 *
 * Client jars are never distributed: they live in `assets/minecraft/<channel>/`
 * (see plan.md, "Minecraft client location") and a missing jar is reported with
 * the full path the host expected.
 *
 * This registry is the single source of truth: the version picker and the
 * per-version feature toggles in the UI are generated from it (via IPC), so
 * adding a tested version means adding one entry here.
 */

export type MinecraftChannel =
  | 'classic'
  | 'indev'
  | 'infdev'
  | 'alpha'
  | 'beta'
  | 'release'
  | 'isom'

/**
 * Host-side patches ported from the LWJGL fork's AppletLoader
 * (`applyDpiResolutionFix` / `patchClassic15aServer`), executed by
 * `runtime/minecraft-host`. Each fix is also surfaced to the game as the same
 * applet parameter the browser-era `<embed>` used, so behaviour matches.
 */
export type MinecraftFix = 'dpi_fix' | '15a_server_patch'

/** A fix as offered to the user: declaration + default switch (MCAJNLP style). */
export interface MinecraftFixOption {
  kind: MinecraftFix
  /** Human-readable name for the launch panel checkbox. */
  label: string
  /**
   * Whether the feature is on by default for this version. The user can
   * toggle it per launch; the UI only ever shows fixes the version declares.
   */
  defaultEnabled: boolean
}

export interface MinecraftVersion {
  /** Unique id, also used as the UI key, e.g. `c0.0.21a_01`. */
  id: string
  channel: MinecraftChannel
  /** Display name for the version picker. */
  label: string
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
   * Values are plain strings; `username`/`sessionid` get defaults at launch
   * time and belong to the settings UI, not the launch panel.
   */
  parameters: Record<string, string>
  /**
   * Host-side optional features this version declares, each with its own
   * default switch — the launch panel renders exactly these as checkboxes.
   * Classic follows MCAHTML/MCAJNLP's per-bucket rules:
   * - classicpre12a (≤ 0.0.12a_03, hardcoded 640x480): only `dpi_fix`;
   * - classic15a (0.0.13a~16a, dead-address connection probe): only
   *   `15a_server_patch` (their init() already reads getWidth()/getHeight(),
   *   so no resolution border to fix);
   * - classicmp (native server/port era): no checkboxes at all.
   * MCAJNLP hardcodes its patches into the launch line instead, but that
   * hides them from the UI.
   */
  fixes?: readonly MinecraftFixOption[]
  /**
   * The client reads `server`/`port` applet parameters natively, so the
   * launch panel can offer the connection fields (MCAJNLP enables its
   * Server/Port inputs per version; confirmed from classic 0.0.15a onward).
   */
  supportsMultiplayer?: boolean
  width: number
  height: number
}

export const CLASSIC_C0_0_21A_01: MinecraftVersion = {
  id: 'c0.0.21a_01',
  channel: 'classic',
  label: 'Classic 0.0.21a_01',
  jar: 'assets/minecraft/classic/c0.0.21a_01.jar',
  appletClass: 'com.mojang.minecraft.MinecraftApplet',
  parameters: {},
  // classicmp bucket (per MCAJNLP's `classic_mp` type): init passes
  // getWidth()/getHeight() and the a/b fields feed DisplayMode from them
  // (javap-verified; a live test shows no border), and server/port are read
  // natively — so like every classic_mp version it declares no patch
  // checkboxes at all, only the multiplayer inputs stay enabled.
  supportsMultiplayer: true,
  width: 854,
  height: 480
}

/**
 * classicpre12a bucket. Test version: MinecraftApplet hard-codes the
 * framebuffer at 640x480 — the 2026-09-26 test run showed the black border at
 * the right of the 854x480 window. `dpi_fix` (ported from the LWJGL fork)
 * rewrites the Minecraft a/b fields (which feed both glViewport and
 * Display.setDisplayMode) to the real container size between init() and
 * start(); verified 2026-09-27: `640x480 -> 854x480`, border gone.
 */
export const CLASSIC_C0_0_12A_03_200018: MinecraftVersion = {
  id: 'c0.0.12a_03-200018',
  channel: 'classic',
  label: 'Classic 0.0.12a_03 (200018) [size test]',
  jar: 'assets/minecraft/classic/c0.0.12a_03-200018.jar',
  appletClass: 'com.mojang.minecraft.MinecraftApplet',
  parameters: {},
  fixes: [{ kind: 'dpi_fix', label: 'Resolution fix (dpi_fix)', defaultEnabled: true }],
  width: 854,
  height: 480
}

/**
 * classic15a bucket (0.0.13a~16a in MCAJNLP's whitelist). Test version:
 * vanilla 0.0.15a init() natively reads server/port applet parameters, but
 * spends seconds trying the dead hard-coded classic.mojang.com address first
 * (the black screen before singleplayer, seen 2026-09-26).
 * `15a_server_patch` replaces init() with the fork's reflective setup: instant
 * singleplayer unless a `server` is given, in which case it connects directly.
 * Only the patch checkbox is offered in this bucket — no dpi_fix (init()
 * already reads getWidth()/getHeight(), and MCAHTML scopes dpi_fix to the
 * pre-12a_03 era). 0.0.13a/14a share the same init() shape, so the patch could
 * be declared for them once those jars are registered and tested.
 */
export const CLASSIC_C0_0_15A_05311904: MinecraftVersion = {
  id: 'c0.0.15a-05311904',
  channel: 'classic',
  label: 'Classic 0.0.15a (05311904) [multiplayer test]',
  jar: 'assets/minecraft/classic/c0.0.15a-05311904.jar',
  appletClass: 'com.mojang.minecraft.MinecraftApplet',
  parameters: {},
  fixes: [
    { kind: '15a_server_patch', label: 'Skip connection probe (15a_server_patch)', defaultEnabled: true }
  ],
  supportsMultiplayer: true,
  width: 854,
  height: 480
}

/**
 * Test version: classic-family clients never re-scale the world view when the
 * canvas grows — this checks how a fixed content size behaves inside an
 * arbitrary window. Indev 20100223 ships the later obfuscated namespace
 * `net.minecraft.client.MinecraftApplet` (verified with javap).
 */
export const INDEV_20100223: MinecraftVersion = {
  id: 'in-20100223',
  channel: 'indev',
  label: 'Indev 20100223 [scaling test]',
  jar: 'assets/minecraft/indev/in-20100223.jar',
  appletClass: 'net.minecraft.client.MinecraftApplet',
  parameters: {},
  // Indev reaches multiplayer through its own level flow, not the
  // server/port applet parameters; leave off until tested.
  width: 854,
  height: 480
}

export const KNOWN_VERSIONS: readonly MinecraftVersion[] = [
  CLASSIC_C0_0_21A_01,
  CLASSIC_C0_0_12A_03_200018,
  CLASSIC_C0_0_15A_05311904,
  INDEV_20100223
]

export function getMinecraftVersion(id: string): MinecraftVersion {
  const version = KNOWN_VERSIONS.find((entry) => entry.id === id)
  if (!version) {
    throw new Error(
      `Unknown Minecraft version "${id}"; known: ${KNOWN_VERSIONS.map((v) => v.id).join(', ')}`
    )
  }
  return version
}
