import type { JavaArchitecture, JavaDetectionOptions, JavaInstallation, JavaSelection } from './model'

const DEFAULT_REQUIRED_MAJOR = 8

/** Selection order from the plan: Java 8 x86_64 first, Java 8 x86 as a fallback. */
const ARCHITECTURE_PREFERENCE: JavaArchitecture[] = ['x86_64', 'x86', 'arm64', 'arm', 'unknown']

export function requiredMajor(options: JavaDetectionOptions = {}): number {
  return options.requiredMajor ?? DEFAULT_REQUIRED_MAJOR
}

function compareInstallations(a: JavaInstallation, b: JavaInstallation): number {
  const preference =
    ARCHITECTURE_PREFERENCE.indexOf(a.architecture) - ARCHITECTURE_PREFERENCE.indexOf(b.architecture)
  if (preference !== 0) return preference
  // Newest update of the same feature release first. Ties keep the discovery order,
  // because `Array.prototype.sort` is stable and candidates arrive by source priority.
  if (a.patch !== b.patch) return b.patch - a.patch
  return b.minor - a.minor
}

/**
 * Picks the JVM Minecraft should run on. A 32-bit Java 8 is only accepted when no
 * 64-bit one exists, and the caller is told that the fallback was used.
 */
export function selectJavaInstallation(
  installations: JavaInstallation[],
  options: JavaDetectionOptions = {}
): JavaSelection {
  const major = requiredMajor(options)
  const compatible = installations.filter((entry) => entry.major === major)

  if (compatible.length === 0) {
    const found = installations.map((entry) => `${entry.raw} (${entry.architecture})`)
    return {
      installation: null,
      usedFallback: false,
      reason:
        found.length === 0
          ? `no Java installation could be probed; Java ${major} is required`
          : `Java ${major} is not installed; found: ${[...new Set(found)].join(', ')}`
    }
  }

  const sorted = [...compatible].sort(compareInstallations)
  const selected = sorted[0]
  const usedFallback = selected.architecture === 'x86'

  return {
    installation: selected,
    usedFallback,
    reason: usedFallback
      ? `no 64-bit Java ${major} found, falling back to the 32-bit installation`
      : `Java ${major} ${selected.architecture} selected`
  }
}
