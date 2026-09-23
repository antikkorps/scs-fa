import type { FastifyReply, FastifyRequest } from "fastify"
import { describe, expect, it, vi } from "vitest"
import { replyForStorageReadFailure } from "./http.js"
import { InMemoryStorageService } from "./memory.js"
import { ObjectNotFoundError } from "./types.js"

function fakeReply() {
  const sent: { status?: number; body?: unknown } = {}
  const reply = {
    code(status: number) {
      sent.status = status
      return reply
    },
    send(body: unknown) {
      sent.body = body
      return reply
    },
  }
  return { reply: reply as unknown as FastifyReply, sent }
}

function fakeRequest() {
  const error = vi.fn()
  return { request: { log: { error } } as unknown as FastifyRequest, error }
}

describe("replyForStorageReadFailure", () => {
  it("answers 404 for an object that is genuinely not there", () => {
    const { reply, sent } = fakeReply()
    const { request, error } = fakeRequest()

    replyForStorageReadFailure(new ObjectNotFoundError("gun-art/public/x.webp"), request, reply, "k", "Image not found")

    expect(sent.status).toBe(404)
    expect(sent.body).toEqual({ error: "NotFound", message: "Image not found" })
    // A missing object is an ordinary outcome, not an incident.
    expect(error).not.toHaveBeenCalled()
  })

  it("answers 502 and logs the cause when the store itself fails", () => {
    const { reply, sent } = fakeReply()
    const { request, error } = fakeRequest()
    const forbidden = Object.assign(new Error("Forbidden"), { name: "Forbidden" })

    replyForStorageReadFailure(forbidden, request, reply, "gun-art/public/x.webp", "Image not found")

    // Not 404: the object may well exist. Answering "gone" during an outage
    // would have caches and crawlers drop every visual on the site.
    expect(sent.status).toBe(502)
    expect(sent.body).toEqual({ error: "BadGateway", message: "Storage temporarily unavailable" })
    expect(error).toHaveBeenCalledWith({ err: forbidden, key: "gun-art/public/x.webp" }, "storage read failed")
  })
})

describe("InMemoryStorageService", () => {
  it("signals a miss with ObjectNotFoundError, so callers can tell it from a failure", async () => {
    const storage = new InMemoryStorageService()
    await expect(storage.getBytes("nope")).rejects.toBeInstanceOf(ObjectNotFoundError)
  })
})
