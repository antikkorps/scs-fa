import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildApp } from "../app.js"
import { CLIENT_ERRORS_PER_MINUTE, type ClientErrorReport, toLogEntry } from "./index.js"

const report: ClientErrorReport = {
  kind: "error",
  message: "Cannot read properties of undefined (reading 'total')",
  path: "/commande",
  stack: "TypeError: Cannot read properties of undefined\n    at checkout.vue:42:7",
}

describe("toLogEntry (story 12.7d)", () => {
  it("keeps what helps debugging", () => {
    expect(toLogEntry({ ...report, code: "api_connection_error", relatedReqId: "req-1" }, "Mozilla/5.0")).toEqual({
      kind: "error",
      message: report.message,
      path: "/commande",
      stack: report.stack,
      code: "api_connection_error",
      relatedReqId: "req-1",
      userAgent: "Mozilla/5.0",
    })
  })

  it("scrubs e-mail addresses and long digit runs (a card number) that slipped into a message", () => {
    const entry = toLogEntry(
      { ...report, message: "No account for jean.dupont@example.fr", stack: "at pay(4242424242424242)" },
      undefined,
    )
    expect(entry.message).toBe("No account for [redacted]")
    expect(entry.stack).toBe("at pay([redacted])")
  })

  it("drops a query string from the path: it can carry tokens", () => {
    expect(toLogEntry({ ...report, path: "/commande?token=abc" }, undefined).path).toBe("/commande")
  })
})

describe("POST /api/client-errors (story 12.7d)", () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  const send = (payload: unknown, remoteAddress = "203.0.113.10") =>
    app.inject({
      method: "POST",
      url: "/api/client-errors",
      payload: payload as Record<string, unknown>,
      remoteAddress,
    })

  it("accepts a report without any session", async () => {
    expect((await send(report)).statusCode).toBe(204)
  })

  it("refuses a report from outside the cart, checkout and payment pages", async () => {
    expect((await send({ ...report, path: "/admin/orders" })).statusCode).toBe(400)
  })

  it("refuses an unknown kind, an oversized field or extra fields", async () => {
    expect((await send({ ...report, kind: "nonsense" })).statusCode).toBe(400)
    expect((await send({ ...report, message: "x".repeat(501) })).statusCode).toBe(400)
    expect((await send({ ...report, formValues: { email: "jean@example.fr" } })).statusCode).toBe(400)
  })

  it("refuses a body over a few kilobytes", async () => {
    expect((await send({ ...report, stack: "x".repeat(20_000) })).statusCode).toBe(413)
  })

  it(`accepts ${CLIENT_ERRORS_PER_MINUTE} reports a minute per visitor, then answers 429`, async () => {
    const visitor = "203.0.113.99"
    for (let sent = 0; sent < CLIENT_ERRORS_PER_MINUTE; sent++) {
      expect((await send(report, visitor)).statusCode).toBe(204)
    }
    expect((await send(report, visitor)).statusCode).toBe(429)
    expect((await send(report, "203.0.113.100")).statusCode).toBe(204)
  })
})
