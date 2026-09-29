/**
 * Shared contracts between the Electron main process, the preload bridge and
 * the Vue renderer. The renderer never imports Node, Electron or the runtime
 * implementation — it only sees these serialisable shapes.
 */

export const IPC = {
  /** Returns basic information about the host process. */
  HOST_GET_INFO: 'host:get-info',
  /** Discovers, executes and selects a Java 8 runtime. */
  JAVA_DETECT: 'java:detect',
  /** Launches the game process for a known version id. */
  MINECRAFT_LAUNCH: 'minecraft:launch',
  /** Asks the running game process to terminate. */
  MINECRAFT_STOP: 'minecraft:stop',
  /** Current state of the game process (also used for polling). */
  MINECRAFT_STATUS: 'minecraft:status',
  /** Registered versions for the picker, straight from the runtime registry. */
  MINECRAFT_LIST_VERSIONS: 'minecraft:list-versions',
  /** Enumerates the Applet entry classes inside a version's client jar (offline scan). */
  MINECRAFT_LIST_APPLETS: 'minecraft:list-applets'
} as const

export interface HostInfo {
  /** MCANextGen version, injected at build time. */
  hostVersion: string
  platform: string
  arch: string
  electronVersion: string
  nodeVersion: string
  chromeVersion: string
}

export type JavaArchitecture = 'x86_64' | 'x86' | 'arm64' | 'arm' | 'unknown'

export interface JavaInstallationView {
  executable: string
  /** Raw `java.version`, e.g. `1.8.0_431`. */
  version: string
  architecture: JavaArchitecture
  /** How the installation was discovered: manual / env / registry / directory / path. */
  source: string
  /** True for the JVM MCANextGen would launch Minecraft with. */
  selected: boolean
}

export interface JavaStatusView {
  requiredMajor: number
  /** False when no Java 8 runtime could be selected. */
  ok: boolean
  /** Short explanation of the selection, or of the failure. */
  reason: string
  /** True when the 32-bit fallback was chosen. */
  usedFallback: boolean
  installations: JavaInstallationView[]
  failures: { executable: string; reason: string }[]
  diagnostics: string[]
  durationMs: number
}

/** Native window detection for the running game process (Phase 2, Win32 only). */
export interface MinecraftWindowView {
  /**
   * `pending`: process is up but no top-level window yet;
   * `found`: the game window is owned by the process;
   * `lost`: a window was seen before and has since disappeared;
   * `none`: nothing to track (no session / unsupported platform).
   */
  state: 'none' | 'pending' | 'found' | 'lost'
  /** Whether native window capture is available on this platform. */
  supported: boolean
  /** Window handle in hex, e.g. `0x1a2b3c`. */
  hwnd: string | null
  pid: number | null
  /** Win32 window class name, e.g. `SunAwtFrame`. */
  className: string | null
  title: string | null
}

export interface MinecraftStateView {
  running: boolean
  /** Version id of the current/last game session, e.g. `c0.0.21a_01`. */
  versionId: string | null
  pid: number | null
  /** Exit status once the game has stopped. */
  exitCode: number | null
  exitSignal: string | null
  /** Last launch failure message (missing jar, no Java 8, …). */
  error: string | null
  /** Native window detection for the current session. */
  window: MinecraftWindowView
}

/** Mirrors MinecraftFix in the runtime registry (kept as a literal so the renderer stays dependency-free). */
export type MinecraftFixKind = 'dpi_fix' | '15a_server_patch'

/** An optional host-side patch the launch panel can toggle. */
export interface MinecraftFixView {
  kind: MinecraftFixKind
  label: string
  defaultEnabled: boolean
}

export interface MinecraftVersionOptionView {
  id: string
  label: string
  /** Optional features declared for this version (empty when none apply). */
  fixes: MinecraftFixView[]
  /** True when the client natively reads `server`/`port` applet parameters. */
  supportsMultiplayer: boolean
}

/** Per-launch switches the panel sends; omitted fields keep registry defaults. */
export interface MinecraftLaunchOptionsView {
  /** Exactly the fixes to run for this launch (checkbox state). */
  fixesEnabled?: MinecraftFixKind[]
  /** `server`/`port` from the connection fields; blank entries are dropped. */
  extraParameters?: Record<string, string>
  /** Applet entry class override picked from the jar scan (e.g. the isom preview). */
  appletClass?: string
}

/** Result of the offline class-file scan for one version's jar. */
export interface MinecraftAppletList {
  /**
   * Launchable Applet entry classes found in the jar, sorted (infdev 20100617:
   * regular client + `net.minecraft.isom.IsomPreviewApplet`). The panel's
   * entry dropdown always shows these — even a single entry is surfaced so
   * the user can see which class will actually launch.
   */
  appletClasses: string[]
  /** The registry default the dropdown should preselect. */
  defaultAppletClass: string
  /** Scan failure message; empty on success (the panel then just keeps the default). */
  error: string | null
}

export interface HostApi {
  getInfo(): Promise<HostInfo>
  detectJava(): Promise<JavaStatusView>
  launchMinecraft(versionId: string, options?: MinecraftLaunchOptionsView): Promise<MinecraftStateView>
  stopMinecraft(): Promise<MinecraftStateView>
  getMinecraftStatus(): Promise<MinecraftStateView>
  listMinecraftVersions(): Promise<MinecraftVersionOptionView[]>
  listMinecraftApplets(versionId: string): Promise<MinecraftAppletList>
}
