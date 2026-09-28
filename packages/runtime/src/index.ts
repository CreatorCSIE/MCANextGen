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

export type { MinecraftChannel, MinecraftFix, MinecraftVersion } from './minecraft/version'
export {
  CLASSIC_C0_0_12A_03_200018,
  CLASSIC_C0_0_15A_05311904,
  CLASSIC_C0_0_21A_01,
  INDEV_20100223,
  KNOWN_VERSIONS,
  getMinecraftVersion
} from './minecraft/version'
export type { MinecraftLayout } from './minecraft/layout'
export {
  HOST_JAR_PATH,
  LWJGL_VERSION,
  missingMinecraftAssets,
  resolveMinecraftLayout
} from './minecraft/layout'
export type { MinecraftExitInfo, MinecraftGame, MinecraftLaunchOptions } from './minecraft/launch'
export { MinecraftLaunchError, launchMinecraft } from './minecraft/launch'
export type { AppletClassList } from './minecraft/applets'
export { listAppletClasses } from './minecraft/applets'
export {
  DEFAULT_FIX_ARGUMENTS,
  DEFAULT_GAME_JVM_ARGUMENTS,
  DEFAULT_JVM_ARGUMENTS
} from './minecraft/arguments'
