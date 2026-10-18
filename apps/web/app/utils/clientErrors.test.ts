import { describe, expect, it, vi } from "vitest"
import {
  createClientErrorReporter,
  isNetworkFailure,
  isReportableStripeError,
  reportClientError,
  sendClientErrorReport,
  setClientErrorReporter,
} from "./clientErrors.js"

function reporterOn(path: string) {
  const send = vi.fn()
  return { send, report: createClientErrorReporter({ path: () => path, send }) }
}

describe("createClientErrorReporter (story 12.7d)", () => {
  it("reports an error on the cart, the checkout and an order's payment page", () => {
    for (const path of ["/panier", "/commande", "/commande/0b7d1f3e"]) {
      const { send, report } = reporterOn(path)
      report("error", new TypeError("boom"))
      expect(send).toHaveBeenCalledTimes(1)
    }
  })

  it("stays silent everywhere else", () => {
    const { send, report } = reporterOn("/boutique")
    report("error", new TypeError("boom"))
    expect(send).not.toHaveBeenCalled()
  })

  it("sends the message, the stack and the path without its query string", () => {
    const { send, report } = reporterOn("/commande?step=2")
    const error = new TypeError("Cannot read properties of undefined")
    report("vue", error)
    expect(send).toHaveBeenCalledWith({
      kind: "vue",
      message: "Cannot read properties of undefined",
      path: "/commande",
      stack: error.stack?.slice(0, 4000),
    })
  })

  it("bounds what it sends to what the API accepts", () => {
    const { send, report } = reporterOn("/panier")
    report("unhandledrejection", "x".repeat(2000))
    expect(send.mock.calls[0]?.[0].message).toHaveLength(500)
  })

  it("adds a code when there is one, e.g. Stripe's", () => {
    const { send, report } = reporterOn("/commande/1")
    report("stripe", new Error("Stripe API unreachable"), { code: "api_connection_error" })
    expect(send.mock.calls[0]?.[0]).toMatchObject({ kind: "stripe", code: "api_connection_error" })
  })

  it("sends an error only once per page, however often it happens", () => {
    const { send, report } = reporterOn("/panier")
    for (let times = 0; times < 5; times++) report("error", new TypeError("boom"))
    report("error", new TypeError("another"))
    expect(send).toHaveBeenCalledTimes(2)
  })
})

describe("isNetworkFailure", () => {
  it("is a fetch that never got an answer, not an API refusal", () => {
    expect(isNetworkFailure(Object.assign(new Error("fetch failed"), { name: "FetchError" }))).toBe(true)
    expect(isNetworkFailure(Object.assign(new Error("409"), { name: "FetchError", response: { status: 409 } }))).toBe(
      false,
    )
    expect(isNetworkFailure(new TypeError("boom"))).toBe(false)
  })
})

describe("isReportableStripeError", () => {
  it("leaves out what the customer can fix (a declined card, an incomplete field)", () => {
    expect(isReportableStripeError({ type: "card_error" })).toBe(false)
    expect(isReportableStripeError({ type: "validation_error" })).toBe(false)
    expect(isReportableStripeError({ type: "api_connection_error" })).toBe(true)
    expect(isReportableStripeError({ type: "api_error" })).toBe(true)
  })
})

describe("reportClientError", () => {
  it("does nothing until a reporter is set (the server never sets one)", () => {
    expect(() => reportClientError("error", new Error("boom"))).not.toThrow()
  })

  it("hands the error to the reporter once set", () => {
    const report = vi.fn()
    setClientErrorReporter(report)
    reportClientError("stripe", new Error("down"), { code: "api_error" })
    expect(report).toHaveBeenCalledWith("stripe", expect.any(Error), { code: "api_error" })
    setClientErrorReporter(null)
  })
})

describe("sendClientErrorReport", () => {
  it("posts the report through the same-origin proxy, surviving a page change", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)
    const report = { kind: "error" as const, message: "boom", path: "/panier" }

    sendClientErrorReport(report)

    expect(fetchMock).toHaveBeenCalledWith("/bff/api/client-errors", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
    })
    vi.unstubAllGlobals()
  })

  it("never throws: a report that cannot leave must not break the page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))
    expect(() => sendClientErrorReport({ kind: "network", message: "x", path: "/panier" })).not.toThrow()
    await Promise.resolve()
    vi.unstubAllGlobals()
  })
})
