import Fastify from "fastify"
import { describe, expect, it } from "vitest"
import { isInternalCall, isPrivateAddress, trustDirectPrivatePeer } from "./client-ip.js"

describe("isPrivateAddress", () => {
  it("recognises loopback and the private ranges Docker networks use", () => {
    for (const ip of ["127.0.0.1", "10.0.3.7", "172.18.0.4", "192.168.1.20", "::1", "fd00::5", "::ffff:172.18.0.4"]) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
  })
  it("rejects public addresses and garbage", () => {
    for (const ip of ["8.8.8.8", "172.32.0.1", "104.16.0.1", "2606:4700::1", "not-an-ip", ""]) {
      expect(isPrivateAddress(ip), ip).toBe(false)
    }
  })
})

describe("client IP resolution through Fastify (story 9.6)", () => {
  async function ipSeen(remoteAddress: string, xff?: string) {
    const app = Fastify({ trustProxy: trustDirectPrivatePeer })
    app.get("/", async (request) => ({ ip: request.ip }))
    const res = await app.inject({
      method: "GET",
      url: "/",
      remoteAddress,
      headers: xff ? { "x-forwarded-for": xff } : {},
    })
    await app.close()
    return res.json().ip as string
  }

  it("takes the client IP the private proxy forwarded", async () => {
    expect(await ipSeen("172.18.0.2", "203.0.113.9")).toBe("203.0.113.9")
  })

  it("cannot be spoofed by a client prepending its own X-Forwarded-For", async () => {
    // Caddy overwrites the header, but even an appended chain only yields the
    // hop the proxy wrote — never the left-most, client-chosen value.
    expect(await ipSeen("172.18.0.2", "1.2.3.4, 203.0.113.9")).toBe("203.0.113.9")
  })

  it("ignores X-Forwarded-For from a public peer", async () => {
    expect(await ipSeen("198.51.100.7", "1.2.3.4")).toBe("198.51.100.7")
  })

  it("falls back to the peer when no proxy header is present", async () => {
    expect(await ipSeen("172.18.0.2")).toBe("172.18.0.2")
  })
})

describe("isInternalCall", () => {
  const SECRET = "s".repeat(40)
  const req = (value?: string) =>
    ({ headers: value === undefined ? {} : { "x-internal-auth": value } }) as Parameters<typeof isInternalCall>[0]

  it("accepts the shared secret only", () => {
    expect(isInternalCall(req(SECRET), SECRET)).toBe(true)
    expect(isInternalCall(req(`${SECRET}x`), SECRET)).toBe(false)
    expect(isInternalCall(req("nope"), SECRET)).toBe(false)
    expect(isInternalCall(req(), SECRET)).toBe(false)
  })

  it("never matches when no secret is configured — not even an empty header", () => {
    expect(isInternalCall(req(""), undefined)).toBe(false)
  })
})
