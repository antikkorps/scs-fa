import { describe, expect, it } from "vitest"
import { forwardedRequestHeaders, forwardedResponseHeaders } from "./proxy-headers"

describe("forwardedResponseHeaders", () => {
  it("passes on the type, the download name and the caching rule — never a cookie", () => {
    const headers = new Headers({
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="catalogue-2026-10-07.xlsx"',
      "cache-control": "no-store",
      "set-cookie": "session=upstream",
      "x-powered-by": "fastify",
    })
    expect(forwardedResponseHeaders(headers)).toEqual([
      ["content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      ["content-disposition", 'attachment; filename="catalogue-2026-10-07.xlsx"'],
      ["cache-control", "no-store"],
    ])
  })

  it("skips what upstream did not send", () => {
    expect(forwardedResponseHeaders(new Headers({ "content-type": "application/json" }))).toEqual([
      ["content-type", "application/json"],
    ])
  })
})

describe("forwardedRequestHeaders", () => {
  it("passes on the body type and a refund's idempotency key (story 12.9g) — never a cookie", () => {
    const sent: Record<string, string> = {
      "content-type": "application/json",
      "idempotency-key": "3f1c2a9e-0d4b-4c51-9f0e-6a7b8c9d0e1f",
      cookie: "scs_access=browser",
      authorization: "Bearer from-the-browser",
    }
    expect(forwardedRequestHeaders((name) => sent[name])).toEqual({
      "content-type": "application/json",
      "idempotency-key": "3f1c2a9e-0d4b-4c51-9f0e-6a7b8c9d0e1f",
    })
  })

  it("skips what the browser did not send", () => {
    expect(forwardedRequestHeaders(() => undefined)).toEqual({})
  })
})
