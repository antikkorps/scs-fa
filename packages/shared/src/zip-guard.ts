// A zip bomb guard for the workbook reader. exceljs inflates the whole archive
// in memory, trusting it; a few kilobytes of upload can declare — or simply
// produce — gigabytes. So the archive is inflated once here first, against a
// budget, before exceljs is allowed near it.
//
// Every entry is inflated for real, capped at the size it declares: a bomb
// that lies in its headers is caught by what it produces, not by what it says.

import { inflateRawSync } from "node:zlib"

export interface ZipLimits {
  /** Total size of the archive once inflated. */
  maxUnzippedBytes: number
  /** A workbook holds a few dozen parts. */
  maxEntries: number
}

const END_OF_DIRECTORY = 0x06054b50
const DIRECTORY_ENTRY = 0x02014b50
const LOCAL_HEADER = 0x04034b50
const END_OF_DIRECTORY_SIZE = 22
const MAX_COMMENT_SIZE = 0xffff
const ZIP64_MARKER = 0xffffffff
const STORED = 0
const DEFLATED = 8

/** Thrown with a message meant for logs; callers wrap it in their own error. */
export class ZipLimitError extends Error {}

function findEndOfDirectory(view: DataView): number {
  const lowest = Math.max(0, view.byteLength - END_OF_DIRECTORY_SIZE - MAX_COMMENT_SIZE)
  for (let at = view.byteLength - END_OF_DIRECTORY_SIZE; at >= lowest; at--) {
    if (view.getUint32(at, true) === END_OF_DIRECTORY) return at
  }
  throw new ZipLimitError("Zip directory not found")
}

interface Entry {
  method: number
  compressedSize: number
  declaredSize: number
  localHeaderOffset: number
}

function readDirectory(view: DataView, limits: ZipLimits): Entry[] {
  const end = findEndOfDirectory(view)
  const count = view.getUint16(end + 10, true)
  if (count > limits.maxEntries) throw new ZipLimitError(`Too many zip entries: ${limits.maxEntries} at most`)

  const entries: Entry[] = []
  let at = view.getUint32(end + 16, true)
  for (let i = 0; i < count; i++) {
    if (at + 46 > view.byteLength || view.getUint32(at, true) !== DIRECTORY_ENTRY) {
      throw new ZipLimitError("Corrupt zip directory")
    }
    const entry = {
      method: view.getUint16(at + 10, true),
      compressedSize: view.getUint32(at + 20, true),
      declaredSize: view.getUint32(at + 24, true),
      localHeaderOffset: view.getUint32(at + 42, true),
    }
    // Zip64 is for archives past 4 GB: never a workbook anyone uploads.
    if ([entry.compressedSize, entry.declaredSize, entry.localHeaderOffset].includes(ZIP64_MARKER)) {
      throw new ZipLimitError("Zip64 archives are not accepted")
    }
    entries.push(entry)
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
  }
  return entries
}

function inflatedSize(bytes: Uint8Array, view: DataView, entry: Entry): number {
  const at = entry.localHeaderOffset
  if (at + 30 > view.byteLength || view.getUint32(at, true) !== LOCAL_HEADER) {
    throw new ZipLimitError("Corrupt zip entry")
  }
  const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true)
  const data = bytes.subarray(start, start + entry.compressedSize)

  if (entry.method === STORED) return data.length
  if (entry.method !== DEFLATED) throw new ZipLimitError(`Unsupported zip compression method ${entry.method}`)
  try {
    // One byte of headroom, so an entry producing more than it declares is caught.
    return inflateRawSync(data, { maxOutputLength: entry.declaredSize + 1 }).length
  } catch (err) {
    const tooLarge = (err as { code?: string }).code === "ERR_BUFFER_TOO_LARGE"
    throw new ZipLimitError(tooLarge ? "Zip entry inflates past the size it declares" : "Corrupt zip entry")
  }
}

/** Throw a ZipLimitError unless the archive inflates within the limits. */
export function assertZipWithinLimits(bytes: Uint8Array, limits: ZipLimits): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const entries = readDirectory(view, limits)

  // Cheap first: the sizes the archive declares.
  const declared = entries.reduce((sum, entry) => sum + entry.declaredSize, 0)
  if (declared > limits.maxUnzippedBytes) throw new ZipLimitError("Zip archive too large once inflated")

  for (const entry of entries) {
    if (inflatedSize(bytes, view, entry) > entry.declaredSize) {
      throw new ZipLimitError("Zip entry inflates past the size it declares")
    }
  }
}
