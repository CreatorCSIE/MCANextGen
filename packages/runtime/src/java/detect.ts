import type {
  JavaDetectionOptions,
  JavaDetectionReport,
  JavaInstallation,
  JavaProbeFailure
} from './model'
import { discoverJavaCandidates } from './discover'
import { probeJavaExecutable } from './probe'
import { requiredMajor, selectJavaInstallation } from './select'

/** Number of JVMs started at the same time while probing. */
const PROBE_CONCURRENCY = 4

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0

  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index])
    }
  })

  await Promise.all(runners)
  return results
}

/**
 * Full Java runtime probe: discover candidates, execute each one, then apply the
 * selection rules. Never throws — a machine without Java 8 is a report, not an error.
 */
export async function detectJavaRuntime(
  options: JavaDetectionOptions = {}
): Promise<JavaDetectionReport> {
  const startedAt = Date.now()
  const platform = options.platform ?? process.platform
  const major = requiredMajor(options)

  const { candidates, diagnostics } = await discoverJavaCandidates(
    platform,
    options.manualPaths ?? []
  )

  const probes = await mapWithConcurrency(candidates, PROBE_CONCURRENCY, (candidate) =>
    probeJavaExecutable(candidate.executable, candidate.source, options.probeTimeoutMs)
  )

  const installations: JavaInstallation[] = []
  const failures: JavaProbeFailure[] = []

  probes.forEach((probe, index) => {
    if (probe.ok) {
      installations.push(probe.installation)
    } else {
      failures.push({
        executable: candidates[index].executable,
        source: candidates[index].source,
        reason: probe.reason
      })
    }
  })

  // A JDK exposes two equivalent launchers (`<jdk>\bin\java` and its private
  // `<jdk>\jre\bin\java`); report the runtime once, keeping the higher-priority path.
  const unique = new Map<string, JavaInstallation>()
  for (const installation of installations) {
    const home =
      platform === 'win32' ? installation.javaHome.toLowerCase() : installation.javaHome
    const key = `${home}|${installation.raw}|${installation.architecture}`
    if (!unique.has(key)) unique.set(key, installation)
  }

  const usable = [...unique.values()]
  const selection = selectJavaInstallation(usable, options)

  if (selection.installation === null) {
    diagnostics.push(`no usable Java ${major} executable among ${candidates.length} candidates`)
  }

  return {
    requiredMajor: major,
    platform,
    installations: usable,
    failures,
    selection,
    diagnostics,
    startedAt,
    finishedAt: Date.now()
  }
}
