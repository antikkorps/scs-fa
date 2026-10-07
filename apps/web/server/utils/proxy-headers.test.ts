import { describe, expect, it } from "vitest"
import { forwardedResponseHeaders } from "./proxy-headers"

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
