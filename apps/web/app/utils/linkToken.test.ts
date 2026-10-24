import { describe, expect, it } from "vitest"
import { linkTokenFromHash, withoutLinkTokens, withoutLinkTokensInEvent } from "./linkToken"

describe("linkTokenFromHash (story 12.9g)", () => {
  it("reads the token of a mailed link's fragment", () => {
    expect(linkTokenFromHash("#token=abc123")).toBe("abc123")
    expect(linkTokenFromHash("#other=1&token=abc123")).toBe("abc123")
  })

  it("is empty without a token", () => {
    expect(linkTokenFromHash("")).toBe("")
    expect(linkTokenFromHash("#")).toBe("")
    expect(linkTokenFromHash("#section")).toBe("")
  })
})

describe("withoutLinkTokens (story 12.9g)", () => {
  it("drops a token from the query string and keeps the rest", () => {
    expect(withoutLinkTokens("https://www.example.fr/newsletter/desabonnement?token=abc&utm_source=mail")).toBe(
      "https://www.example.fr/newsletter/desabonnement?utm_source=mail",
    )
  })

  it("drops a token from the fragment", () => {
    expect(withoutLinkTokens("https://www.example.fr/reset-password#token=abc")).toBe(
      "https://www.example.fr/reset-password",
    )
  })

  it("leaves a URL without a token unchanged", () => {
    expect(withoutLinkTokens("https://www.example.fr/recherche?q=colt")).toBe("https://www.example.fr/recherche?q=colt")
    expect(withoutLinkTokens("/boutique")).toBe("/boutique")
  })

  it("passes through what it cannot parse", () => {
    expect(withoutLinkTokens("")).toBe("")
  })
})

describe("withoutLinkTokensInEvent (story 12.9g)", () => {
  it("cleans the page and referrer URLs of an audience event, and keeps the rest", () => {
    expect(
      withoutLinkTokensInEvent({
        website: "w",
        url: "/newsletter/desabonnement?token=abc",
        referrer: "https://mail.example/?token=xyz",
        title: "Désabonnement",
      }),
    ).toEqual({
      website: "w",
      url: "/newsletter/desabonnement",
      referrer: "https://mail.example/",
      title: "Désabonnement",
    })
  })

  it("leaves an event without URLs alone", () => {
    expect(withoutLinkTokensInEvent({ name: "click" })).toEqual({ name: "click" })
  })
})
