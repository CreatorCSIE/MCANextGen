/**
 * Enumerates the launchable Applet entry classes inside a client jar —
 * offline, by parsing class-file headers (see bytecode.ts).
 *
 * Why: MCAHTML/MCAJNLP model the Infinite Map Visualizer as its own channel
 * with a hand-mapped main class, but infdev 20100617 jars ship *both*
 * `net.minecraft.client.MinecraftApplet` and
 * `net.minecraft.isom.IsomPreviewApplet` — “isom” is simply a second entry
 * class in the same jar, so no separate folder is needed.
 *
 * The judgement stays authoritative rather than name-based: for every class
 * we read the real this/super chain, access flags and `<init>()V` straight
 * out of the constant pool — the same facts an in-process
 * `Applet.class.isAssignableFrom` check would consult — but with no JVM
 * spawn (nothing can open a window, and it works even before Java 8 exists
 * on the machine). This mirrors DECRAFT_Launcher's `JavaClassReader`
 * approach; the previous JVM-booting scan cost ~0.4s per version.
 */

import type { MinecraftLayout } from './layout'
import { parseClassMeta, readJarEntries, type ClassMeta } from './bytecode'

export interface AppletClassList {
  /** Fully-qualified applet entry classes, sorted; one entry = nothing to choose. */
  appletClasses: string[]
}

const JAVA_APPLET = 'java/applet/Applet'
const ACC_PUBLIC = 0x0020
const ACC_ABSTRACT = 0x0400

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

/** Scans `layout.clientJar` for launchable Applet entry classes. */
export function listAppletClasses(layout: MinecraftLayout): AppletClassList {
  // One pass over the whole classpath: every jar contributes to the
  // super-class index (a client applet could extend a base that lives in a
  // companion jar), but only the client jar produces candidates.
  const index = new Map<string, ClassMeta>()
  const candidates: ClassMeta[] = []
  for (const jar of [layout.clientJar, ...layout.lwjglJars]) {
    const isClientJar = jar === layout.clientJar
    for (const entry of readJarEntries(jar)) {
      if (!entry.name.endsWith('.class')) continue
      const meta = parseClassMeta(entry.data)
      if (!meta) continue
      if (!index.has(meta.thisName)) index.set(meta.thisName, meta)
      if (isClientJar) candidates.push(meta)
    }
  }
  const appletClasses = candidates
    .filter((meta) => isLaunchableApplet(index, meta))
    .map((meta) => meta.thisName.replaceAll('/', '.'))
    .sort()
  return { appletClasses }
}

function isLaunchableApplet(index: Map<string, ClassMeta>, meta: ClassMeta): boolean {
  // Mirrors what the Java host needs to instantiate the applet: a public,
  // concrete, top-level class with a public no-arg constructor whose super
  // chain reaches java.applet.Applet. Inner classes (`Foo$Bar`) are never
  // independent entries, matching the previous JVM scan.
  if (meta.thisName.includes('$')) return false
  if ((meta.accessFlags & (ACC_PUBLIC | ACC_ABSTRACT)) !== ACC_PUBLIC) return false
  if (!meta.hasPublicNoArgInit) return false
  return extendsApplet(index, meta.thisName)
}

function extendsApplet(index: Map<string, ClassMeta>, className: string): boolean {
  // The walk stops at any super outside the scanned jars. Legacy clients
  // extend java.applet.Applet (or client-jar bases) directly; JDK-internal
  // intermediates like javax.swing.JApplet are not used by this era's jars.
  const seen = new Set<string>()
  let current: string | null | undefined = index.get(className)?.superName
  while (current !== null && current !== undefined && !seen.has(current)) {
    if (current === JAVA_APPLET) return true
    seen.add(current)
    current = index.get(current)?.superName
  }
  return false
}
