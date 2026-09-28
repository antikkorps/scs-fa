import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { isPublicAddress, SafeFetchError, safeGet } from "./safe-fetch.js"

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata endpoint
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "ff02::1",
  ])("refuses %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(false)
  })

  it.each([
    "8.8.8.8",
    "151.101.1.1",
    "172.32.0.1",
    "2a00:1450:4007:80b::200e",
    "::ffff:8.8.8.8",
  ])("accepts %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(true)
  })
})

describe("safeGet", () => {
  let server: Server
  let base: string
  // The test server is on loopback, which the real guard refuses — exactly the
  // point. The tests widen the guard explicitly to reach it.
  const allowLoopback = { isAllowedAddress: (ip: string) => ip === "127.0.0.1" }

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/img") {
        res.writeHead(200, { "content-type": "image/jpeg" })
        res.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
      } else if (req.url === "/big") {
        res.writeHead(200, { "content-type": "image/jpeg" })
        res.end(Buffer.alloc(2048))
      } else if (req.url === "/redirect") {
        res.writeHead(302, { location: "/img" })
        res.end()
      } else if (req.url === "/loop") {
        res.writeHead(302, { location: "/loop" })
        res.end()
      } else if (req.url === "/to-file") {
        res.writeHead(302, { location: "file:///etc/passwd" })
        res.end()
      } else if (req.url === "/slow") {
        // Never answers.
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })

  it("refuses loopback by default — the guard is on unless widened", async () => {
    await expect(safeGet(`${base}/img`)).rejects.toThrow(/address/i)
  })

  it("refuses a hostname that resolves to a private address", async () => {
    await expect(safeGet(`http://localhost:${new URL(base).port}/img`)).rejects.toBeInstanceOf(SafeFetchError)
  })

  it("refuses non-http schemes and credentials in the URL", async () => {
    await expect(safeGet("file:///etc/passwd")).rejects.toThrow(/scheme/i)
    await expect(safeGet("https://user:pw@example.com/a.jpg")).rejects.toThrow(/credentials/i)
  })

  it("downloads the body with its content type", async () => {
    const res = await safeGet(`${base}/img`, allowLoopback)
    expect(res.contentType).toBe("image/jpeg")
    expect([...res.body]).toEqual([0xff, 0xd8, 0xff, 0xe0])
  })

  it("follows a redirect, re-checking the target", async () => {
    const res = await safeGet(`${base}/redirect`, allowLoopback)
    expect(res.body.length).toBe(4)
    expect(res.finalUrl).toBe(`${base}/img`)
  })

  it("refuses a redirect to another scheme and stops a redirect loop", async () => {
    await expect(safeGet(`${base}/to-file`, allowLoopback)).rejects.toThrow(/scheme/i)
    await expect(safeGet(`${base}/loop`, allowLoopback)).rejects.toThrow(/redirect/i)
  })

  it("aborts a body larger than the cap", async () => {
    await expect(safeGet(`${base}/big`, { ...allowLoopback, maxBytes: 1024 })).rejects.toThrow(/large/i)
  })

  it("fails on an HTTP error status", async () => {
    await expect(safeGet(`${base}/missing`, allowLoopback)).rejects.toThrow(/404/)
  })

  it("times out", async () => {
    await expect(safeGet(`${base}/slow`, { ...allowLoopback, timeoutMs: 200 })).rejects.toThrow(/time/i)
  })
})
