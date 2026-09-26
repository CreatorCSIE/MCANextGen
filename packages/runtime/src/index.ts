export type {
  JavaArchitecture,
  JavaDetectionOptions,
  JavaDetectionReport,
  JavaDiscoverySource,
  JavaInstallation,
  JavaProbeFailure,
  JavaSelection,
  JavaVersion
} from './java/model'

export { detectJavaRuntime } from './java/detect'
export { discoverJavaCandidates, type JavaCandidate } from './java/discover'
export { probeJavaExecutable, type ProbeResult } from './java/probe'
export { javaMajorVersion, normaliseArchitecture, parseJavaVersion, parseVersionBanner } from './java/version'
export { selectJavaInstallation } from './java/select'
