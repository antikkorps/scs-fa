import { MAX_MEDIA_SIZE_BYTES } from "@armurier/shared"
import { describe, expect, it } from "vitest"
import { BFF_AUTH_BODY_LIMIT_BYTES, BFF_PROXY_BODY_LIMIT_BYTES, bffBodyRefusal } from "./bodyLimit"

describe("bffBodyRefusal (story 12.9f)", () => {
  it("lets the largest upload the API accepts through the proxy", () => {
    expect(BFF_PROXY_BODY_LIMIT_BYTES).toBeGreaterThan(MAX_MEDIA_SIZE_BYTES)
    expect(bffBodyRefusal("/bff/api/admin/media", { contentLength: String(MAX_MEDIA_SIZE_BYTES + 4096) })).toBeNull()
  })

  it("refuses a proxied body over the limit", () => {
    expect(bffBodyRefusal("/bff/api/legal-documents", { contentLength: String(BFF_PROXY_BODY_LIMIT_BYTES + 1) })).toBe(
      413,
    )
  })

  it("keeps the auth routes to a small JSON body", () => {
    expect(bffBodyRefusal("/bff/auth/login", { contentLength: "512" })).toBeNull()
    expect(bffBodyRefusal("/bff/auth/login", { contentLength: String(BFF_AUTH_BODY_LIMIT_BYTES + 1) })).toBe(413)
  })

  it("refuses a streamed body whose size is not announced", () => {
    expect(bffBodyRefusal("/bff/api/orders", { transferEncoding: "chunked" })).toBe(411)
  })

  it("lets a request without a body through", () => {
    expect(bffBodyRefusal("/bff/auth/logout", {})).toBeNull()
  })

  it("refuses a malformed Content-Length", () => {
    expect(bffBodyRefusal("/bff/api/orders", { contentLength: "12abc" })).toBe(400)
  })

  it("ignores what is not the BFF", () => {
    expect(bffBodyRefusal("/collection", { contentLength: String(BFF_PROXY_BODY_LIMIT_BYTES * 2) })).toBeNull()
  })
})
