/**
 * Data model of the Java runtime layer. Kept free of Node/Electron types so the
 * same shapes can be serialised over IPC to the renderer.
 */

/** Where a candidate Java installation was found. */
export type JavaDiscoverySource = 'env' | 'path' | 'registry' | 'directory' | 'manual'

/** Normalised CPU architecture of a JVM. */
export type JavaArchitecture = 'x86_64' | 'x86' | 'arm64' | 'arm' | 'unknown'

export interface JavaVersion {
  /** Raw `java.version` property, e.g. `1.8.0_202`. */
  raw: string
  /** Feature release; Java 8 is reported as `8`, not `1.8`. */
  major: number
  minor: number
  patch: number
  /** `java.runtime.version` when available. */
  runtimeRaw?: string
  vendor?: string
}

export interface JavaInstallation extends JavaVersion {
  /** Absolute path of the probed `java` executable. */
  executable: string
  /** `java.home` as reported by the JVM itself. */
  javaHome: string
  architecture: JavaArchitecture
  source: JavaDiscoverySource
  /** Wall-clock time of the probe, useful when several JVMs are on slow disks. */
  probeDurationMs: number
}

export interface JavaProbeFailure {
  executable: string
  source: JavaDiscoverySource
  /** Short human readable reason, e.g. `ENOENT` or `probe timeout after 4000ms`. */
  reason: string
}

export interface JavaSelection {
  /** The JVM MCANextGen should launch Minecraft with, if any. */
  installation: JavaInstallation | null
  /** True when a 32-bit Java 8 was chosen because no 64-bit one exists. */
  usedFallback: boolean
  reason: string
}

export interface JavaDetectionReport {
  requiredMajor: number
  platform: NodeJS.Platform
  installations: JavaInstallation[]
  failures: JavaProbeFailure[]
  selection: JavaSelection
  /** Non-fatal notes (skipped sources, unreadable registry keys, …). */
  diagnostics: string[]
  startedAt: number
  finishedAt: number
}

export interface JavaDetectionOptions {
  /** Java majors to look for. Defaults to 8 (LWJGL 2 + MinecraftApplet requirement). */
  requiredMajor?: number
  /** Extra `java` executables or JDK/JRE homes supplied by user settings. */
  manualPaths?: string[]
  /** Per-executable probe timeout. */
  probeTimeoutMs?: number
  /** Override the platform, used by tests. */
  platform?: NodeJS.Platform
}
