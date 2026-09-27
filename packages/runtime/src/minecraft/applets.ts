/**
 * Enumerates the launchable Applet entry classes inside a client jar.
 *
 * Why: MCAHTML/MCAJNLP model the Infinite Map Visualizer as its own channel
 * with a hand-mapped main class, but infdev 20100617 jars ship *both*
 * `net.minecraft.client.MinecraftApplet` and
 * `net.minecraft.isom.IsomPreviewApplet` — “isom” is simply a second entry
 * class in the same jar, so no separate folder is needed.
 *
 * The judgement runs in a short-lived headless JVM via the host jar's
 * `--list-applets` mode: a real `Applet.class.isAssignableFrom` check
 * (`loadClass` only — no initialisation, no window), not a class-name
 * heuristic, so renamed or oddly-named entries are still found.
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import type { MinecraftLayout } from './layout'

export interface AppletClassList {
  /** Fully-qualified applet entry classes, sorted; one entry = nothing to choose. */
  appletClasses: string[]
  /** Host stderr tail for diagnostics when the scan fails. */
  log: string[]
}

/** Line prefix emitted by `org.mcanextgen.host.MinecraftHost --list-applets`. */
const APPLET_LINE_PREFIX = 'MCANEXTGEN_APPLET '

/**
 * Window titles for alternate entry classes, keyed by fully-qualified name.
 * The regular Minecraft client keeps the shared "Minecraft" title; the isom
 * preview is a different program that happens to live in the same jar, so its
 * frame says what it is (MCAHTML titled that page "Infinite Map Visualizer").
 */
const APPLET_WINDOW_TITLES: Readonly<Record<string, string>> = {
  'net.minecraft.isom.IsomPreviewApplet': 'Infinite Map Visualizer'
}

/** Host window title for an entry class, or undefined for the default. */
export function appletWindowTitle(appletClass: string): string | undefined {
  return APPLET_WINDOW_TITLES[appletClass]
}

export class AppletScanError extends Error {
  readonly log: string[]

  constructor(message: string, log: string[]) {
    super(message)
    this.name = 'AppletScanError'
    this.log = log
  }
}

/** Scans `layout.clientJar` for Applet entry classes using the probed Java 8. */
export function listAppletClasses(
  javaExecutable: string,
  layout: MinecraftLayout,
  timeoutMs = 20_000
): Promise<AppletClassList> {
  const args = [
    '-Djava.awt.headless=true',
    `-Dmcanextgen.jars=${[layout.clientJar, ...layout.lwjglJars].join(path.delimiter)}`,
    `-Dmcanextgen.scanJar=${layout.clientJar}`,
    '-cp',
    layout.hostJar,
    'org.mcanextgen.host.MinecraftHost',
    '--list-applets'
  ]
  return new Promise((resolve, reject) => {
    const child = spawn(javaExecutable, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const appletClasses: string[] = []
    const log: string[] = []
    let stderrBuf = ''
    const collect = (chunk: Buffer | string): void => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim() === '') continue
        if (line.startsWith(APPLET_LINE_PREFIX)) {
          appletClasses.push(line.slice(APPLET_LINE_PREFIX.length).trim())
        } else {
          log.push(line)
        }
      }
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += String(chunk)
      collect(chunk)
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new AppletScanError(`Applet 入口枚举超时（${timeoutMs / 1000}s）`, log))
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new AppletScanError(`无法启动 Java 扫描进程: ${error.message}`, log))
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve({ appletClasses, log })
      else
        reject(
          new AppletScanError(
            `Applet 入口枚举失败（java 退出码 ${code}）: ${stderrBuf.trim() || log.join('\n')}`,
            log
          )
        )
    })
  })
}
