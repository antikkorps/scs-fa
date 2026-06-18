// Content-based file-type detection (magic bytes).
//
// Upload validation must never trust the client-supplied Content-Type header —
// it is fully attacker-controlled. We sniff the leading bytes of the payload and
// require the detected type to be an allowed legal-document format AND to match
// the declared MIME type. This blocks mislabeled payloads (e.g. an HTML/SVG/JS
// file announced as `image/png`) and polyglots from being stored.

import type { AllowedLegalDocMimeType } from "./constants.js"

// Each signature is a list of bytes the payload must start with (offset 0).
// JPEG covers the SOI marker shared by JFIF/Exif/raw variants; PNG and PDF use
// their canonical headers.
const MAGIC_SIGNATURES: ReadonlyArray<{
  mime: AllowedLegalDocMimeType
  bytes: readonly number[]
}> = [
  // %PDF-
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  // JPEG SOI + first marker byte
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  // PNG 8-byte signature
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
]

function startsWith(buffer: Uint8Array, signature: readonly number[]): boolean {
  if (buffer.length < signature.length) return false
  for (let i = 0; i < signature.length; i++) {
    if (buffer[i] !== signature[i]) return false
  }
  return true
}

/**
 * Detect the real MIME type of a buffer from its leading bytes.
 * Returns null when the content matches no allowed legal-document format.
 */
export function detectLegalDocMimeType(buffer: Uint8Array): AllowedLegalDocMimeType | null {
  for (const { mime, bytes } of MAGIC_SIGNATURES) {
    if (startsWith(buffer, bytes)) return mime
  }
  return null
}

/**
 * True when the payload's real (sniffed) type is allowed AND equals the type the
 * client declared. A mismatch (or unrecognized content) is rejected.
 */
export function fileContentMatchesDeclaredMime(buffer: Uint8Array, declaredMime: string): boolean {
  const detected = detectLegalDocMimeType(buffer)
  return detected !== null && detected === declaredMime
}
