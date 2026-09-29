/**
 * Minimal zero-dependency readers for the two file formats the offline
 * Applet-entry scan needs: ZIP (jar) central-directory lookup and JVM
 * class-file headers (constant pool, access flags, this/super names,
 * constructors).
 *
 * Why offline (approach borrowed from DECRAFT_Launcher's `JavaClassReader`):
 * the facts that decide "is this a launchable Applet subclass with a public
 * no-arg constructor" are stored verbatim in every class file, so the scan
 * can read them directly instead of booting a throwaway JVM. That keeps the
 * judgement authoritative (a real super-class chain, not a class-name
 * heuristic) while costing milliseconds, spawning nothing, and not even
 * requiring a Java installation.
 */

import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

export interface JarEntry {
  /** Path inside the jar, e.g. `net/minecraft/isom/IsomPreviewApplet.class`. */
  name: string
  /** Decompressed contents. */
  data: Buffer
}

/** `ELF` of the local file header / central directory / end-of-central-directory. */
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const EOCD_SIGNATURE = 0x06054b50
const EOCD_MIN_SIZE = 22
const EOCD_MAX_COMMENT = 0xffff

/**
 * Reads every entry of an uncompressed/deflated zip (jar) with its contents
 * decompressed. Old client jars never use zip64 or encrypted entries; anything
 * unexpected throws instead of guessing (the scan caller degrades gracefully).
 */
export function readJarEntries(jarPath: string): JarEntry[] {
  const buf = readFileSync(jarPath)
  let eocd = -1
  const earliest = Math.max(0, buf.length - EOCD_MIN_SIZE - EOCD_MAX_COMMENT)
  for (let i = buf.length - EOCD_MIN_SIZE; i >= earliest; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error(`not a readable zip file: ${jarPath}`)

  const entryCount = buf.readUInt16LE(eocd + 10)
  const entries: JarEntry[] = []
  let p = buf.readUInt32LE(eocd + 16)
  for (let n = 0; n < entryCount; n++) {
    if (buf.readUInt32LE(p) !== CENTRAL_SIGNATURE) {
      throw new Error(`corrupt zip central directory: ${jarPath}`)
    }
    const method = buf.readUInt16LE(p + 10)
    const compressedSize = buf.readUInt32LE(p + 20)
    const nameLength = buf.readUInt16LE(p + 28)
    const extraLength = buf.readUInt16LE(p + 30)
    const commentLength = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    // Class paths inside jars are ASCII; utf8 is a safe superset here.
    const name = buf.toString('utf8', p + 46, p + 46 + nameLength)
    p += 46 + nameLength + extraLength + commentLength

    if (buf.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new Error(`corrupt zip local header: ${jarPath}!${name}`)
    }
    // The local header repeats its own name/extra lengths — they may differ
    // from the central directory, so read them from the local header itself.
    const localNameLength = buf.readUInt16LE(localOffset + 26)
    const localExtraLength = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const raw = buf.subarray(dataStart, dataStart + compressedSize)
    let data: Buffer
    if (method === 0) data = Buffer.from(raw)
    else if (method === 8) data = inflateRawSync(raw)
    else throw new Error(`unsupported zip method ${method}: ${jarPath}!${name}`)
    entries.push({ name, data })
  }
  return entries
}

/**
 * Everything the offline scans read out of a class file's header: the Applet
 * entry scan uses this/super/access/init, the capability probe (see
 * capabilities.ts) uses the member references, field types, `bipush`
 * immediates and string constants.
 */
export interface ClassMeta {
  /** Internal name, e.g. `net/minecraft/isom/IsomPreviewApplet`. */
  thisName: string
  /** Internal super-class name; null for `java/lang/Object` (super index 0). */
  superName: string | null
  accessFlags: number
  /** Public no-argument `<init>()V`, explicit or the implicit default one. */
  hasPublicNoArgInit: boolean
  /**
   * Every NameAndType in the pool as `name:descriptor` — i.e. all method and
   * field *references* made from this class (owner-agnostic by design; the
   * capability anchors match on member name + descriptor, e.g. `getWidth:()I`).
   */
  memberRefs: Set<string>
  /**
   * The same member references qualified with their resolved owner class,
   * e.g. `java/awt/Canvas.getWidth:()I`. Owner matters for size anchors:
   * Classic-era game loops only reference `DisplayMode.getWidth` (display
   * mode enumeration at fullscreen init), while resizing clients poll
   * `Canvas.getWidth` per frame — owner-blind matching conflated the two
   * (measured on 0.0.12a/15a/21a vs Indev 20100223).
   */
  qualifiedRefs: Set<string>
  /** Internal class names referenced from field descriptors (`Lxxx;`). */
  fieldTypeNames: string[]
  /**
   * Immediates of `bipush` opcodes *used as a comparison / call argument*:
   * the byte-pattern scan only records `bipush k` when the very next byte is
   * if_icmpeq (0x9F), if_icmpne (0xA0) or invokestatic (0xB8). A loose scan
   * matches too many raw 0x10 bytes inside multi-byte operands and produced
   * phantom 87/119 hits (measured on Classic 0.0.12a_03-200018), so the
   * adjacency requirement is load-bearing for the fullscreen probe.
   */
  bipushValues: Set<number>
  /** Declared methods as `name:descriptor` (e.g. `run:()V` for the game loop). */
  declaredMethods: Set<string>
  /** Utf8 payloads of the `String` constants (e.g. `Toggle fullscreen!`). */
  strings: Set<string>
}

const ACC_PUBLIC = 0x0001
const CLASS_MAGIC = 0xcafebabe

/**
 * Parses a class file down to the fields the scan needs. Returns null (never
 * throws) for entries that are not well-formed classes, so one exotic file
 * cannot break the whole jar scan.
 */
export function parseClassMeta(bytes: Buffer): ClassMeta | null {
  try {
    return readClassMeta(bytes)
  } catch {
    return null
  }
}

function readClassMeta(buf: Buffer): ClassMeta {
  if (buf.length < 10 || buf.readUInt32BE(0) !== CLASS_MAGIC) {
    throw new Error('not a class file')
  }
  let p = 8 // magic(4) + minor(2) + major(2)
  const cpCount = buf.readUInt16BE(p)
  p += 2
  const utf8: (string | undefined)[] = []
  const classNameStringIndex: (number | undefined)[] = []
  // NameAndType / String entries are resolved after the pool walk: they may
  // point at Utf8 slots that come later in the pool. Keyed by constant-pool
  // slot so member refs (tag 9/10/11) can look a NameAndType up by index.
  const nameAndTypesBySlot: ([number, number] | undefined)[] = []
  const stringRefs: number[] = []
  // Field/Method/InterfaceMethod refs: [class index, NameAndType index] —
  // resolved after the walk (both sides may point at later pool slots).
  const memberRefEntries: [number, number][] = []
  for (let i = 1; i < cpCount; i++) {
    const tag = buf[p]
    p += 1
    switch (tag) {
      case 1: {
        // Utf8
        const length = buf.readUInt16BE(p)
        p += 2
        utf8[i] = buf.toString('utf8', p, p + length)
        p += length
        break
      }
      case 7: // Class -> name index
        classNameStringIndex[i] = buf.readUInt16BE(p)
        p += 2
        break
      case 8: // String -> Utf8 index
        stringRefs.push(buf.readUInt16BE(p))
        p += 2
        break
      case 12: // NameAndType -> name + descriptor indices
        nameAndTypesBySlot[i] = [buf.readUInt16BE(p), buf.readUInt16BE(p + 2)]
        p += 4
        break
      case 9: // Fieldref
      case 10: // Methodref
      case 11: // InterfaceMethodref -> class index + NameAndType index
        memberRefEntries.push([buf.readUInt16BE(p), buf.readUInt16BE(p + 2)])
        p += 4
        break
      case 5: // Long
      case 6: // Double — occupy two constant-pool slots
        p += 8
        i++
        break
      case 3: // Integer
      case 4: // Float
      case 17: // Dynamic
      case 18: // InvokeDynamic
        p += 4
        break
      case 16: // MethodType
      case 19: // Module
      case 20: // Package
        p += 2
        break
      case 15: // MethodHandle: kind(1) + index(2)
        p += 3
        break
      default:
        throw new Error(`unknown constant-pool tag ${tag}`)
    }
  }

  const memberRefs = new Set<string>()
  for (const nat of nameAndTypesBySlot) {
    if (nat === undefined) continue
    const name = utf8[nat[0]]
    const descriptor = utf8[nat[1]]
    if (name !== undefined && descriptor !== undefined) {
      memberRefs.add(`${name}:${descriptor}`)
    }
  }
  const qualifiedRefs = new Set<string>()
  for (const [classIndex, natIndex] of memberRefEntries) {
    const ownerStringIndex = classNameStringIndex[classIndex]
    const owner = ownerStringIndex === undefined ? undefined : utf8[ownerStringIndex]
    const nat = nameAndTypesBySlot[natIndex]
    if (owner === undefined || nat === undefined) continue
    const name = utf8[nat[0]]
    const descriptor = utf8[nat[1]]
    if (name !== undefined && descriptor !== undefined) {
      qualifiedRefs.add(`${owner}.${name}:${descriptor}`)
    }
  }
  const strings = new Set<string>()
  for (const stringIndex of stringRefs) {
    const value = utf8[stringIndex]
    if (value !== undefined) strings.add(value)
  }

  const accessFlags = buf.readUInt16BE(p)
  const thisClass = buf.readUInt16BE(p + 2)
  const superClass = buf.readUInt16BE(p + 4)
  p += 6

  const name = (cpIndex: number): string => {
    const stringIndex = classNameStringIndex[cpIndex]
    const resolved = stringIndex === undefined ? undefined : utf8[stringIndex]
    if (resolved === undefined) throw new Error(`bad class constant #${cpIndex}`)
    return resolved
  }
  const thisName = name(thisClass)
  const superName = superClass === 0 ? null : name(superClass)

  p += 2 + buf.readUInt16BE(p) * 2 // interfaces_count + its u2 array

  // Fields are parsed (not skipped): their descriptors are the one-hop edge
  // from an applet entry class to the game main class it drives.
  const fieldTypeNames: string[] = []
  const fieldsCount = buf.readUInt16BE(p)
  p += 2
  for (let f = 0; f < fieldsCount; f++) {
    const descriptor = utf8[buf.readUInt16BE(p + 4)]
    if (descriptor !== undefined) {
      for (const match of descriptor.matchAll(/L([^;]+);/g)) {
        fieldTypeNames.push(match[1])
      }
    }
    p = skipAttributes(buf, p + 6)
  }

  const methodsCount = buf.readUInt16BE(p)
  p += 2
  const bipushValues = new Set<number>()
  const declaredMethods = new Set<string>()
  let sawAnyInit = false
  let sawPublicNoArgInit = false
  for (let m = 0; m < methodsCount; m++) {
    const methodAccess = buf.readUInt16BE(p)
    const methodName = utf8[buf.readUInt16BE(p + 2)]
    const methodDescriptor = utf8[buf.readUInt16BE(p + 4)]
    p += 6
    if (methodName === '<init>' && methodDescriptor === '()V') {
      sawAnyInit = true
      if ((methodAccess & ACC_PUBLIC) !== 0) sawPublicNoArgInit = true
    }
    if (methodName !== undefined && methodDescriptor !== undefined) {
      declaredMethods.add(`${methodName}:${methodDescriptor}`)
    }
    p = scanMethodAttributes(buf, p, utf8, bipushValues)
  }

  return {
    thisName,
    superName,
    accessFlags,
    // A class that declares no constructor at all gets the implicit default
    // one, whose visibility follows the (public) class itself.
    hasPublicNoArgInit: sawPublicNoArgInit || !sawAnyInit,
    memberRefs,
    qualifiedRefs,
    fieldTypeNames,
    bipushValues,
    declaredMethods,
    strings
  }
}

/**
 * Walks a method's attributes, collecting `bipush` immediates from Code
 * bodies, and returns the offset after the table.
 *
 * The Code scan is a byte-pattern sweep for the 0x10 (bipush) opcode rather
 * than a full opcode walk — variable-length instructions (tableswitch padding,
 * wide) make precise decoding heavy. To keep the sweep from matching raw 0x10
 * bytes inside other operands, a value is only recorded when the byte after
 * the operand starts a comparison or a static call: if_icmpeq (0x9F),
 * if_icmpne (0xA0) or invokestatic (0xB8) — the shapes `bipush k; if_icmp*`
 * and `bipush k; invokestatic isKeyDown(I)Z` actually compile to.
 */
function scanMethodAttributes(
  buf: Buffer,
  start: number,
  utf8: (string | undefined)[],
  bipushValues: Set<number>
): number {
  let p = start
  const count = buf.readUInt16BE(p)
  p += 2
  for (let i = 0; i < count; i++) {
    const attributeName = utf8[buf.readUInt16BE(p)]
    const length = buf.readUInt32BE(p + 2)
    if (attributeName === 'Code') {
      // Code: max_stack u2, max_locals u2, code_length u4, then the bytes.
      const codeLength = buf.readUInt32BE(p + 10)
      const codeStart = p + 14
      const codeEnd = Math.min(codeStart + codeLength, buf.length - 2)
      for (let c = codeStart; c < codeEnd; c++) {
        if (buf[c] !== 0x10) continue
        const successor = buf[c + 2]
        if (successor === 0x9f || successor === 0xa0 || successor === 0xb8) {
          bipushValues.add(buf[c + 1])
        }
      }
    }
    p += 6 + length
  }
  return p
}

/** Skips the attributes table at `p` (count u2, then name(2)+length(4)+body). */
function skipAttributes(buf: Buffer, p: number): number {
  const count = buf.readUInt16BE(p)
  p += 2
  for (let i = 0; i < count; i++) {
    const length = buf.readUInt32BE(p + 2)
    p += 6 + length
  }
  return p
}
