import net from "node:net"
import { env } from "../env.js"

// Minimal clamd client speaking the INSTREAM protocol over TCP — no external
// dependency. We stream the buffer in length-prefixed chunks and parse the
// daemon's verdict.
//
// Wire format (clamd, `z`-prefixed null-terminated command):
//   "zINSTREAM\0"  then  <4-byte BE length><bytes>...  then  <4-byte BE zero>
// Reply: "stream: OK\0" | "stream: <sig> FOUND\0" | "...ERROR\0".

export type ClamScanResult = "clean" | "infected" | "error"

const CHUNK_SIZE = 64 * 1024
const DEFAULT_TIMEOUT_MS = 30_000

export interface ClamScanOptions {
  host: string
  port: number
  timeoutMs?: number
}

/**
 * Scan a buffer through a clamd daemon. Resolves to "clean"/"infected" on a
 * verdict, or "error" on any connection/timeout/protocol failure — callers must
 * treat "error" as not-clean (the document stays unusable), never as clean.
 */
export function scanBuffer(
  buffer: Buffer,
  options: ClamScanOptions = { host: env.CLAMAV_HOST, port: env.CLAMAV_PORT },
): Promise<ClamScanResult> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: options.host, port: options.port })
    const replyChunks: Buffer[] = []
    let settled = false

    const finish = (result: ClamScanResult) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    socket.on("timeout", () => finish("error"))
    socket.on("error", () => finish("error"))
    socket.on("data", (chunk) => replyChunks.push(chunk))

    socket.on("connect", () => {
      socket.write("zINSTREAM\0")
      for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
        const slice = buffer.subarray(offset, offset + CHUNK_SIZE)
        const length = Buffer.alloc(4)
        length.writeUInt32BE(slice.length, 0)
        socket.write(length)
        socket.write(slice)
      }
      socket.write(Buffer.alloc(4)) // zero-length chunk = end of stream
    })

    socket.on("end", () => {
      const reply = Buffer.concat(replyChunks).toString("utf8")
      if (reply.includes("FOUND")) return finish("infected")
      if (reply.includes("OK")) return finish("clean")
      finish("error")
    })
  })
}
