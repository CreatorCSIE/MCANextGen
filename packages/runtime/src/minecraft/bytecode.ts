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

/** Everything the Applet scan reads out of a class file's header. */
export interface ClassMeta {
  /** Internal name, e.g. `net/minecraft/isom/IsomPreviewApplet`. */
  thisName: string
  /** Internal super-class name; null for `java/lang/Object` (super index 0). */
  superName: string | null
  accessFlags: number
  /** Public no-argument `<init>()V`, explicit or the implicit default one. */
  hasPublicNoArgInit: boolean
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
      case 5: // Long
      case 6: // Double — occupy two constant-pool slots
        p += 8
        i++
        break
      case 3: // Integer
      case 4: // Float
      case 9: // Fieldref
      case 10: // Methodref
      case 11: // InterfaceMethodref
      case 12: // NameAndType
      case 17: // Dynamic
      case 18: // InvokeDynamic
        p += 4
        break
      case 8: // String
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
  const fieldsCount = buf.readUInt16BE(p)
  p = skipMembers(buf, p + 2, fieldsCount)
  const methodsCount = buf.readUInt16BE(p)
  p += 2

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
    p = skipAttributes(buf, p)
  }

  return {
    thisName,
    superName,
    accessFlags,
    // A class that declares no constructor at all gets the implicit default
    // one, whose visibility follows the (public) class itself.
    hasPublicNoArgInit: sawPublicNoArgInit || !sawAnyInit
  }
}

/** Skips `count` field_info/method_info entries (attributes included). */
function skipMembers(buf: Buffer, start: number, count: number): number {
  let p = start
  for (let i = 0; i < count; i++) {
    p += 6 // access_flags + name_index + descriptor_index
    p = skipAttributes(buf, p)
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
