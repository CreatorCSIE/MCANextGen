import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

import type { JavaDiscoverySource } from './model'

const execFileAsync = promisify(execFile)

export interface JavaCandidate {
  executable: string
  source: JavaDiscoverySource
  /** Lower is preferred when two installations report the same version. */
  priority: number
}

/** Windows registry roots that vendor installers write installation paths into. */
const WINDOWS_REGISTRY_KEYS: { key: string; priority: number }[] = [
  { key: 'HKLM\\SOFTWARE\\JavaSoft\\JDK', priority: 20 },
  { key: 'HKLM\\SOFTWARE\\JavaSoft\\JRE', priority: 20 },
  { key: 'HKLM\\SOFTWARE\\JavaSoft\\Java Development Kit', priority: 21 },
  { key: 'HKLM\\SOFTWARE\\JavaSoft\\Java Runtime Environment', priority: 21 },
  // Oracle's JRE-only installs publish their home under the browser plug-in key.
  { key: 'HKLM\\SOFTWARE\\JavaSoft\\Java Plug-in', priority: 21 },
  // 32-bit installations on a 64-bit Windows host.
  { key: 'HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft\\JDK', priority: 22 },
  { key: 'HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft\\JRE', priority: 22 },
  { key: 'HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft\\Java Development Kit', priority: 23 },
  { key: 'HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft\\Java Runtime Environment', priority: 23 },
  { key: 'HKLM\\SOFTWARE\\Eclipse Adoptium\\JDK', priority: 24 },
  { key: 'HKLM\\SOFTWARE\\Amazon Corretto\\jdk', priority: 25 },
  { key: 'HKLM\\SOFTWARE\\Azul Systems\\Zulu', priority: 26 }
]

/** Value names vendors use for an installation root. */
const REGISTRY_HOME_VALUES = new Set([
  'javahome',
  'runtimeroot',
  'installationroot',
  'installationdirectory',
  'path'
])

const WINDOWS_VENDOR_SUBDIRS = [
  'Java',
  'Eclipse Adoptium',
  'Temurin',
  'Amazon Corretto',
  'Zulu',
  'Azul Systems',
  'BellSoft',
  'Semeru',
  'AdoptOpenJDK',
  'Microsoft'
]

const POSIX_VENDOR_ROOTS = ['/usr/lib/jvm', '/usr/java', '/opt/java', '/usr/local/java']

/** `Program Files`, `Program Files (x86)`, ... environment variables. */
function windowsProgramFilesDirs(env: NodeJS.ProcessEnv): string[] {
  const dirs = [env['ProgramFiles'], env['ProgramFiles(x86)'], env['ProgramW6432']]
  return [...new Set(dirs.filter((dir): dir is string => Boolean(dir)))]
}

function listDirectory(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function realPath(target: string): string {
  try {
    return realpathSync(target)
  } catch {
    return target
  }
}

/**
 * Turns a discovery hit into a concrete `java` executable path.
 * A hit may be an installation root (`C:\...\jdk1.8.0_202`) or the binary itself.
 */
function resolveExecutable(root: string, platform: NodeJS.Platform): string | null {
  const binary = platform === 'win32' ? 'java.exe' : 'java'
  const trimmed = root.trim().replace(/^"|"$/g, '')
  if (!trimmed) return null

  const direct = path.join(trimmed, 'bin', binary)
  if (existsSync(direct)) return direct
  if (path.basename(trimmed).toLowerCase() === binary && existsSync(trimmed)) return trimmed
  return null
}

function dedupeKey(executable: string, platform: NodeJS.Platform): string {
  const normalised = path.resolve(realPath(executable))
  return platform === 'win32' ? normalised.toLowerCase() : normalised
}

/**
 * Collects candidate `java` executables.
 *
 * PATH is scanned last and ranked lowest: on a modern machine the default `java`
 * is a recent JDK, while Java 8 normally sits next to it and is only reachable
 * through the registry, `JAVA_HOME` or the vendor installation directories.
 */
export async function discoverJavaCandidates(
  platform: NodeJS.Platform,
  manualPaths: string[] = [],
  env: NodeJS.ProcessEnv = process.env
): Promise<{ candidates: JavaCandidate[]; diagnostics: string[] }> {
  const diagnostics: string[] = []
  const found: JavaCandidate[] = []

  const add = (root: string | undefined, source: JavaDiscoverySource, priority: number): void => {
    if (!root) return
    const executable = resolveExecutable(root, platform)
    if (executable) found.push({ executable, source, priority })
  }

  for (const manual of manualPaths) {
    add(manual, 'manual', 0)
  }

  add(env['JAVA_HOME'], 'env', 10)
  for (const [name, value] of Object.entries(env)) {
    if (/^(?:JAVA|JDK)(?:_HOME)?[_.-]?(?:8|1[._]8)(?:[_.-]?(?:x64|x86|64|32))?$/.test(name)) {
      add(value, 'env', 11)
    }
  }

  if (platform === 'win32') {
    const registryHomes = await queryWindowsRegistry(diagnostics)
    for (const home of registryHomes) {
      add(home.location, 'registry', home.priority)
    }
    for (const programFiles of windowsProgramFilesDirs(env)) {
      for (const vendor of WINDOWS_VENDOR_SUBDIRS) {
        const vendorRoot = path.join(programFiles, vendor)
        for (const entry of listDirectory(vendorRoot)) {
          const installation = path.join(vendorRoot, entry)
          add(installation, 'directory', 40)
          // Vendors such as Corretto nest the JRE one level deeper.
          for (const nested of listDirectory(installation)) {
            add(path.join(installation, nested), 'directory', 41)
          }
        }
      }
    }
  } else {
    for (const root of POSIX_VENDOR_ROOTS) {
      for (const entry of listDirectory(root)) {
        add(path.join(root, entry), 'directory', 40)
      }
    }
  }

  for (const dir of (env['PATH'] ?? '').split(path.delimiter)) {
    if (dir.trim()) {
      add(path.join(dir, platform === 'win32' ? 'java.exe' : 'java'), 'path', 50)
    }
  }

  const seen = new Map<string, JavaCandidate>()
  for (const candidate of found.sort((a, b) => a.priority - b.priority)) {
    const key = dedupeKey(candidate.executable, platform)
    if (!seen.has(key)) seen.set(key, candidate)
  }

  if (seen.size === 0) {
    diagnostics.push('no java executable found on this machine')
  }

  return { candidates: [...seen.values()], diagnostics }
}

/**
 * Reads installation roots from the vendor registry keys. A missing key makes
 * `reg.exe` exit non-zero, which is the normal case and not an error.
 */
async function queryWindowsRegistry(
  diagnostics: string[]
): Promise<{ location: string; priority: number }[]> {
  const homes: { location: string; priority: number }[] = []

  await Promise.all(
    WINDOWS_REGISTRY_KEYS.map(async ({ key, priority }) => {
      let output: string
      try {
        const { stdout } = await execFileAsync('reg.exe', ['query', key, '/s'], {
          windowsHide: true,
          timeout: 4_000,
          encoding: 'utf8'
        })
        output = stdout
      } catch {
        return
      }

      for (const line of output.split(/\r?\n/)) {
        const match = /^\s{4}(.+?)\s+(REG_[A-Z_]+)\s+(.+)$/.exec(line)
        if (!match) continue
        const [, name, kind, value] = match
        if (!REGISTRY_HOME_VALUES.has(name.trim().toLowerCase())) continue
        if (kind !== 'REG_SZ' && kind !== 'REG_EXPAND_SZ') continue
        if (!/[\\/]/.test(value)) continue
        homes.push({ location: value.trim(), priority })
      }
    })
  )

  if (homes.length === 0) {
    diagnostics.push('no Java installation recorded in the Windows registry')
  }

  return homes
}
