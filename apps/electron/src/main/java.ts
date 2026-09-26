import { detectJavaRuntime, type JavaDetectionReport } from '@mcanextgen/runtime'
import type { JavaInstallationView, JavaStatusView } from '@shared/ipc'

function toView(report: JavaDetectionReport): JavaStatusView {
  const selectedPath = report.selection.installation?.executable

  const installations: JavaInstallationView[] = report.installations
    .slice()
    // Required runtimes first, then newest to oldest: the list is a diagnostic view,
    // so the JVM that actually matters should never be scrolled out of sight.
    .sort((a, b) => {
      const required =
        Number(b.major === report.requiredMajor) - Number(a.major === report.requiredMajor)
      if (required !== 0) return required
      if (a.major !== b.major) return b.major - a.major
      if (a.patch !== b.patch) return b.patch - a.patch
      return b.minor - a.minor
    })
    .map((entry) => ({
      executable: entry.executable,
      version: entry.raw,
      architecture: entry.architecture,
      source: entry.source,
      selected: entry.executable === selectedPath
    }))

  return {
    requiredMajor: report.requiredMajor,
    ok: report.selection.installation !== null,
    reason: report.selection.reason,
    usedFallback: report.selection.usedFallback,
    installations,
    failures: report.failures.map((failure) => ({
      executable: failure.executable,
      reason: failure.reason
    })),
    diagnostics: report.diagnostics,
    durationMs: report.finishedAt - report.startedAt
  }
}

/** Probes every candidate JVM on the machine and applies the Java 8 selection rules. */
export async function detectJava(): Promise<JavaStatusView> {
  return toView(await detectJavaRuntime())
}
