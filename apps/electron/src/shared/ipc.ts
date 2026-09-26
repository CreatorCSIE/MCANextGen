/**
 * Shared contracts between the Electron main process, the preload bridge and
 * the Vue renderer. The renderer never imports Node, Electron or the runtime
 * implementation — it only sees these serialisable shapes.
 */

export const IPC = {
  /** Returns basic information about the host process. */
  HOST_GET_INFO: 'host:get-info',
  /** Discovers, executes and selects a Java 8 runtime. */
  JAVA_DETECT: 'java:detect'
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

export interface HostApi {
  getInfo(): Promise<HostInfo>
  detectJava(): Promise<JavaStatusView>
}
