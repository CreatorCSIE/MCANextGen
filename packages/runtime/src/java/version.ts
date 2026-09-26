import type { JavaArchitecture, JavaVersion } from './model'

/**
 * Normalises the `1.8.0_202` / `8u202` / `11.0.2` family of Java version strings.
 * Legacy `1.x` releases must collapse to the plain feature number, otherwise a
 * Java 8 install would be reported as major version 1.
 */
export function parseJavaVersion(raw: string): JavaVersion | null {
  const cleaned = raw.trim().replace(/^"|"$/g, '')
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[_.-](\d+))?/.exec(cleaned)
  if (!match) return null

  const first = Number(match[1])
  const second = Number(match[2] ?? '0')
  const third = Number(match[3] ?? '0')
  const fourth = match[4]

  const major = first === 1 && second > 0 ? second : first
  const minor = first === 1 && second > 0 ? third : second
  const patch = fourth === undefined ? (first === 1 ? 0 : third) : Number(fourth)

  return { raw: cleaned, major, minor, patch }
}

/** Extracts the quoted version from the first line of a `java -version` banner. */
export function parseVersionBanner(banner: string): JavaVersion | null {
  const line = banner.split(/\r?\n/).find((entry) => entry.trim().length > 0) ?? ''
  const match = /version\s+"([^"]+)"/.exec(line)
  if (!match) return null

  const version = parseJavaVersion(match[1])
  if (!version) return null

  const runtime = /build\s+([^\s)]+)/.exec(banner)
  const vendor = /(Java\(TM\)|OpenJDK)/.exec(line)?.[1]

  return {
    ...version,
    runtimeRaw: runtime?.[1],
    vendor: vendor ?? undefined
  }
}

/** Maps the `os.arch` JVM property onto the architectures MCANextGen cares about. */
export function normaliseArchitecture(osArch: string): JavaArchitecture {
  const arch = osArch.trim().toLowerCase()

  if (arch === 'amd64' || arch === 'x86_64' || arch === 'x64' || arch === 'em64t') {
    return 'x86_64'
  }
  if (/^(i[3-6]86|x86)$/.test(arch)) return 'x86'
  if (arch === 'aarch64' || arch === 'arm64') return 'arm64'
  if (/^arm/.test(arch)) return 'arm'

  return 'unknown'
}

/** `1.8.0_202` → `8`, `11.0.2` → `11`. Returns 0 when unparseable. */
export function javaMajorVersion(version: JavaVersion): number {
  return version.major
}
