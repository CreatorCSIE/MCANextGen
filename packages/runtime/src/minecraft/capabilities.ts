/**
 * Offline capability probe behind the embedding policy (plan.md Phase 3):
 * decides, per Applet entry class, whether the game has a working F11
 * fullscreen toggle and whether it adapts to canvas resizes — by reading
 * class files (see bytecode.ts), never by spawning java.
 *
 * Anchors are obfuscation-agnostic by construction: the entry class is the
 * unobfuscated browser contract (`MinecraftApplet`), the game main class is
 * reached one hop away (field type or super class — both topologies exist
 * across versions), and the decision facts are JDK/LWJGL API references plus
 * key-code immediates, none of which ProGuard-era renaming touches:
 *
 *   fullscreen = one class contains BOTH a fullscreen API reference
 *                (Display.setFullscreen | Frame.setExtendedState/setUndecorated)
 *                AND an F11 key check (bipush 87 LWJGL / 119 AWT).
 *     Co-occurrence matters: Classic 0.0.21a_01 references Display.setFullscreen
 *     in a dead LWJGL experiment but has no F11 check anywhere — API refs alone
 *     would false-positive there (measured, see plan.md matrix).
 *
 *   resizable = the game-loop class (one that declares `run:()V`) polls the
 *     canvas size (`getWidth()I` + `getHeight()I`). Scaling lives in the
 *     renderer class (drawImage to canvas size); the game loop just polls, so
 *     the literal method name "resize" is NOT the anchor. The `run:()V`
 *     requirement excludes the entry wrapper, whose `init()` calls
 *     `canvas.setSize(getWidth(), getHeight())` exactly once — a one-shot
 *     sizing reference, not per-frame resize adaptation (false positive
 *     measured on Classic 0.0.21a_01 and the isom previewer).
 *
 * Registry fields (`supportsFullscreen` / `resizePolicy`) override the probe
 * when some future version misleads it.
 */

import type { MinecraftLayout } from './layout'
import { parseClassMeta, readJarEntries, type ClassMeta } from './bytecode'

export interface EntryCapabilities {
  /** Game-side F11 fullscreen exists and is reachable. */
  fullscreen: boolean
  /** Game adapts its rendering to a resized canvas/window. */
  resizable: boolean
}

const FULLSCREEN_APIS = [
  'setFullscreen:(Z)V', // org/lwjgl/opengl/Display
  'setExtendedState:(I)V', // java/awt/Frame (MAXIMIZED_BOTH pseudo-fullscreen)
  'setUndecorated:(Z)V' // java/awt/Frame
] as const

/** LWJGL Keyboard.KEY_F11 = 87, java.awt.event.KeyEvent.VK_F11 = 119. */
const F11_KEY_CONSTANTS = [87, 119] as const

/**
 * Owner-qualified canvas-size anchors. A resizing client re-reads the AWT
 * canvas every frame (`java/awt/Canvas.getWidth()I` +
 * `getHeight()I`) to notice the host grew it. Owner matters: Classic
 * 0.0.12a/15a/21a game loops reference `org/lwjgl/opengl/DisplayMode.getWidth`
 * (fullscreen display-mode enumeration, never canvas resizes) and the isom
 * previewer calls its own inherited `getWidth`, so an owner-blind `getWidth:()I`
 * match false-positives on all of them (measured, see plan.md matrix).
 */
const SIZE_POLL_REFS = ['java/awt/Canvas.getWidth:()I', 'java/awt/Canvas.getHeight:()I'] as const

const classCache = new Map<string, Map<string, ClassMeta>>()

function clientClasses(clientJar: string): Map<string, ClassMeta> {
  const cached = classCache.get(clientJar)
  if (cached) return cached
  const classes = new Map<string, ClassMeta>()
  for (const entry of readJarEntries(clientJar)) {
    if (!entry.name.endsWith('.class')) continue
    const meta = parseClassMeta(entry.data)
    if (meta && !classes.has(meta.thisName)) classes.set(meta.thisName, meta)
  }
  classCache.set(clientJar, classes)
  return classes
}

/**
 * The classes a probe may consult: the entry itself, its super chain, and the
 * field types of those (one hop). JDK types on the chain simply miss the map —
 * the game class is always inside the client jar.
 */
function probeSet(classes: Map<string, ClassMeta>, entryName: string): Set<string> {
  const probes = new Set<string>()
  const chain: string[] = []
  const seen = new Set<string>()
  let current: string | null | undefined = entryName
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current)
    chain.push(current)
    probes.add(current)
    current = classes.get(current)?.superName
  }
  for (const name of chain) {
    for (const fieldType of classes.get(name)?.fieldTypeNames ?? []) probes.add(fieldType)
  }
  return probes
}

/** Capability verdict for one entry class of `layout.clientJar`. */
export function detectEntryCapabilities(
  layout: MinecraftLayout,
  appletClass: string
): EntryCapabilities {
  const classes = clientClasses(layout.clientJar)
  const entry = classes.get(appletClass.replaceAll('.', '/'))
  if (!entry) return { fullscreen: false, resizable: false }

  let fullscreen = false
  let resizable = false
  for (const name of probeSet(classes, entry.thisName)) {
    const meta = classes.get(name)
    if (!meta) continue
    if (
      !fullscreen &&
      FULLSCREEN_APIS.some((api) => meta.memberRefs.has(api)) &&
      F11_KEY_CONSTANTS.some((key) => meta.bipushValues.has(key))
    ) {
      fullscreen = true
    }
    if (
      !resizable &&
      meta.declaredMethods.has('run:()V') &&
      SIZE_POLL_REFS.every((ref) => meta.qualifiedRefs.has(ref))
    ) {
      resizable = true
    }
  }
  return { fullscreen, resizable }
}
