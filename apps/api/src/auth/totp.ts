// Story 12.8e — the app-based second factor: time-based one-time passwords
// (RFC 6238 over RFC 4226 HOTP), as Google Authenticator, Aegis or 1Password
// compute them: HMAC-SHA1, six digits, a new code every 30 seconds. Pure, with
// node:crypto only.
//
// The server must read the secret back to check a code, so it is stored
// encrypted (AES-256-GCM, dedicated key), never hashed.

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto"

const STEP_SECONDS = 30
const DIGITS = 6
/** Steps accepted either side of now: a phone clock a little off still works. */
const DRIFT_STEPS = 1
const SECRET_BYTES = 20
const ISSUER = "SCS Firearms"
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export function generateTotpSecret(): Buffer {
  return randomBytes(SECRET_BYTES)
}

/** RFC 4648 base32, unpadded: the form authenticator apps take. */
export function base32Encode(bytes: Buffer): string {
  let bits = 0
  let value = 0
  let out = ""
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=]/g, "").toUpperCase()
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of clean) {
    const index = BASE32.indexOf(char)
    if (index < 0) throw new Error("Invalid base32 character")
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** The code for one 30-second step (RFC 4226 dynamic truncation). */
export function totpCode(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const digest = createHmac("sha1", secret).update(counter).digest()
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS
  return String(binary).padStart(DIGITS, "0")
}

/**
 * The step a code was issued for, or null. A step at or before `lastStep` is
 * refused: a code serves once, and an older one never comes back.
 */
export function verifyTotp(secret: Buffer, input: string, now: Date, lastStep: number | null): number | null {
  const code = input.replace(/\s/g, "")
  if (!new RegExp(`^\\d{${DIGITS}}$`).test(code)) return null
  const current = Math.floor(now.getTime() / 1000 / STEP_SECONDS)
  for (let offset = -DRIFT_STEPS; offset <= DRIFT_STEPS; offset++) {
    const step = current + offset
    if (lastStep !== null && step <= lastStep) continue
    if (timingSafeEqual(Buffer.from(totpCode(secret, step)), Buffer.from(code))) return step
  }
  return null
}

/** What the QR code holds: the app learns the secret, the issuer and the account. */
export function otpauthUri(secret: Buffer, account: string): string {
  const label = `${encodeURIComponent(ISSUER)}:${encodeURIComponent(account)}`
  const params = `secret=${base32Encode(secret)}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`
  return `otpauth://totp/${label}?${params}`
}

const IV_BYTES = 12
const TAG_BYTES = 16

function aesKey(key: string): Buffer {
  return Buffer.from(hkdfSync("sha256", key, "", "scs-firearms totp secret", 32))
}

/** base64(iv | tag | ciphertext) — a fresh IV each time, authenticated. */
export function encryptSecret(secret: Buffer, key: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv("aes-256-gcm", aesKey(key), iv)
  const sealed = Buffer.concat([cipher.update(secret), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString("base64")
}

/** Throws on another key or a value tampered with. */
export function decryptSecret(stored: string, key: string): Buffer {
  const raw = Buffer.from(stored, "base64")
  const iv = raw.subarray(0, IV_BYTES)
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv("aes-256-gcm", aesKey(key), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()])
}
