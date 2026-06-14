import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Alerter } from "./alerting.js"
import { buildErrorHandler } from "./error-handler.js"

// A tiny throwaway app exercising the handler in isolation — no DB, no auth.
function buildTestApp(isProduction: boolean) {
  const alert = vi.fn().mockResolvedValue(true)
  const alerter: Alerter = { alert }
  const app: FastifyInstance = Fastify({ logger: false })
  app.setErrorHandler(buildErrorHandler({ isProduction, alerter }))

  app.get("/boom", async () => {
    throw new Error("kaboom: secret detail")
  })
  app.get("/teapot", async () => {
    const err = Object.assign(new Error("nope"), { statusCode: 418 })
    throw err
  })
  return { app, alert }
}

describe("buildErrorHandler", () => {
  let app: FastifyInstance
  let alert: ReturnType<typeof vi.fn>

  afterEach(async () => {
    await app?.close()
  })

  describe("server errors (5xx)", () => {
    beforeEach(() => {
      ;({ app, alert } = buildTestApp(false))
    })

    it("returns a shaped 500 and triggers an alert", async () => {
      const res = await app.inject({ method: "GET", url: "/boom" })
      expect(res.statusCode).toBe(500)
      expect(res.json()).toMatchObject({ error: "InternalServerError" })
      expect(alert).toHaveBeenCalledOnce()
      expect(alert.mock.calls[0][0]).toMatchObject({
        statusCode: 500,
        method: "GET",
        signature: expect.stringContaining("/boom"),
      })
    })

    it("exposes the real message in development", async () => {
      const res = await app.inject({ method: "GET", url: "/boom" })
      expect(res.json().message).toContain("kaboom")
    })
  })

  it("hides internal details behind a generic message in production", async () => {
    ;({ app, alert } = buildTestApp(true))
    const res = await app.inject({ method: "GET", url: "/boom" })
    expect(res.statusCode).toBe(500)
    expect(res.json().message).not.toContain("secret detail")
    expect(res.json().message).toBe("An unexpected error occurred")
  })

  it("passes client errors (4xx) through without alerting", async () => {
    ;({ app, alert } = buildTestApp(false))
    const res = await app.inject({ method: "GET", url: "/teapot" })
    expect(res.statusCode).toBe(418)
    expect(res.json()).toMatchObject({ message: "nope" })
    expect(alert).not.toHaveBeenCalled()
  })
})
