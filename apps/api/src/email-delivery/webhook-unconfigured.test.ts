import Fastify from "fastify"
import { afterAll, describe, expect, it, vi } from "vitest"

// Its own file: the webhook reads its secret once, at import, from an env without it.
vi.mock("../env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../env.js")>()
  return { ...original, env: { ...original.env, EMAIL_WEBHOOK_SECRET: undefined } }
})

const { deliveryWebhookRoutes } = await import("./webhook.js")

describe("delivery reports without a webhook secret", () => {
  const app = Fastify()
  afterAll(() => app.close())

  it("answers 503 rather than accept reports from anyone", async () => {
    await app.register(deliveryWebhookRoutes, { prefix: "/api/webhooks/email" })
    const res = await app.inject({ method: "POST", url: "/api/webhooks/email", payload: { event: "sent" } })
    expect(res.statusCode).toBe(503)
  })
})
