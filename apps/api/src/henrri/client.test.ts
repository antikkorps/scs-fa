import { describe, expect, it } from "vitest"
import { createHenrriClient, HenrriError, henrriClientFromConfig } from "./client.js"

const BASE_URL = "https://henrri.test"
const CLIENT_ID = "client-id"
const CLIENT_SECRET = "very-secret-value"

interface Call {
  method: string
  path: string
  body: unknown
  authorization: string | null
}

type Handler = (call: Call) => { status: number; body?: unknown }

/** A fake Henrri: records every call and answers from `routes` ("METHOD /path"). */
function fakeHenrri(routes: Record<string, Handler>) {
  const calls: Call[] = []
  let tokenCount = 0
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    const method = init?.method ?? "GET"
    const headers = new Headers(init?.headers)
    const call: Call = {
      method,
      path: url.pathname + url.search,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      authorization: headers.get("authorization"),
    }
    calls.push(call)
    const key = `${method} ${url.pathname}`
    let answer: { status: number; body?: unknown }
    if (key === "POST /v1/users/authenticate" && !routes[key]) {
      tokenCount += 1
      answer = { status: 200, body: { access_token: `token-${tokenCount}`, expires_in: 600, token_type: "Bearer" } }
    } else {
      const handler = routes[key]
      answer = handler ? handler(call) : { status: 404, body: { title: "Not Found", status: 404 } }
    }
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "content-type": "application/json" },
    })
  }
  const apiCalls = () => calls.filter((call) => call.path !== "/v1/users/authenticate")
  const authCalls = () => calls.filter((call) => call.path === "/v1/users/authenticate")
  return { fetchImpl, calls, apiCalls, authCalls }
}

function clientFor(fake: ReturnType<typeof fakeHenrri>, clock = { now: 0 }) {
  return createHenrriClient({
    baseUrl: BASE_URL,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    fetchImpl: fake.fetchImpl,
    now: () => clock.now,
  })
}

const documentTypes = {
  status: 200,
  body: {
    elements: [
      { id: 7, label: "Devis", documentKind: "quotation", isAccounting: false },
      { id: 3, label: "Facture", documentKind: "invoice", isAccounting: true },
      { id: 4, label: "Avoir", documentKind: "creditNote", isAccounting: true },
    ],
  },
}
const lineTypes = {
  status: 200,
  body: {
    elements: [
      { id: 11, label: "Texte", type: "text" },
      { id: 12, label: "Article", type: "item" },
    ],
  },
}

describe("Henrri client — authentication", () => {
  it("exchanges the client credentials for a token, then sends it as a bearer", async () => {
    const fake = fakeHenrri({ "GET /v1/documenttypes": () => documentTypes })
    await clientFor(fake).documentTypeId("invoice")

    expect(fake.authCalls()).toHaveLength(1)
    expect(fake.authCalls()[0].body).toEqual({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    expect(fake.apiCalls()[0].authorization).toBe("Bearer token-1")
  })

  it("reuses the token while it is valid", async () => {
    const fake = fakeHenrri({ "GET /v1/documents/5": () => ({ status: 200, body: { id: 5, finalized: false } }) })
    const client = clientFor(fake)
    await client.getDocument(5)
    await client.getDocument(5)
    expect(fake.authCalls()).toHaveLength(1)
  })

  it("renews the token a minute before it expires", async () => {
    const fake = fakeHenrri({ "GET /v1/documents/5": () => ({ status: 200, body: { id: 5, finalized: false } }) })
    const clock = { now: 0 }
    const client = clientFor(fake, clock)
    await client.getDocument(5)
    clock.now = 539_000
    await client.getDocument(5)
    expect(fake.authCalls()).toHaveLength(1)
    clock.now = 541_000
    await client.getDocument(5)
    expect(fake.authCalls()).toHaveLength(2)
    expect(fake.apiCalls().at(-1)?.authorization).toBe("Bearer token-2")
  })

  it("authenticates once for calls made at the same time", async () => {
    const fake = fakeHenrri({ "GET /v1/documents/5": () => ({ status: 200, body: { id: 5, finalized: false } }) })
    const client = clientFor(fake)
    await Promise.all([client.getDocument(5), client.getDocument(5), client.getDocument(5)])
    expect(fake.authCalls()).toHaveLength(1)
  })

  it("re-authenticates once when Henrri rejects the token", async () => {
    let rejected = false
    const fake = fakeHenrri({
      "GET /v1/documents/5": () => {
        if (!rejected) {
          rejected = true
          return { status: 401 }
        }
        return { status: 200, body: { id: 5, finalized: false } }
      },
    })
    await clientFor(fake).getDocument(5)
    expect(fake.authCalls()).toHaveLength(2)
    expect(fake.apiCalls().map((call) => call.authorization)).toEqual(["Bearer token-1", "Bearer token-2"])
  })

  it("fails with AuthenticationFailed, without leaking the secret, when the credentials are refused", async () => {
    const fake = fakeHenrri({ "POST /v1/users/authenticate": () => ({ status: 401 }) })
    const error = await clientFor(fake)
      .getDocument(5)
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(HenrriError)
    expect(error).toMatchObject({ code: "AuthenticationFailed", status: 401, retryable: false })
    expect(JSON.stringify(error)).not.toContain(CLIENT_SECRET)
    expect(String((error as Error).message)).not.toContain(CLIENT_SECRET)
  })
})

describe("Henrri client — errors", () => {
  it("surfaces Henrri's business error code, not retryable", async () => {
    const fake = fakeHenrri({
      "POST /v1/documents/5/finalize": () => ({
        status: 400,
        body: { type: "LINES_MISSING", title: "Lines missing", status: 400, detail: "The document must contain…" },
      }),
    })
    const error = await clientFor(fake)
      .finalizeDocument(5)
      .catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: "LINES_MISSING", status: 400, retryable: false })
  })

  it.each([429, 500, 503])("treats a %s as retryable", async (status) => {
    const fake = fakeHenrri({ "GET /v1/documents/5": () => ({ status }) })
    const error = await clientFor(fake)
      .getDocument(5)
      .catch((caught: unknown) => caught)
    expect(error).toMatchObject({ status, retryable: true })
  })

  it("treats a network failure as retryable", async () => {
    const client = createHenrriClient({
      baseUrl: BASE_URL,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      fetchImpl: async () => {
        throw new TypeError("fetch failed")
      },
    })
    const error = await client.getDocument(5).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: "NetworkError", retryable: true })
  })
})

describe("Henrri client — documents", () => {
  it("resolves the invoice and credit-note types by kind, asking Henrri once", async () => {
    const fake = fakeHenrri({ "GET /v1/documenttypes": () => documentTypes })
    const client = clientFor(fake)
    expect(await client.documentTypeId("invoice")).toBe(3)
    expect(await client.documentTypeId("creditNote")).toBe(4)
    expect(fake.apiCalls()).toHaveLength(1)
  })

  it("creates an empty draft for a customer", async () => {
    const fake = fakeHenrri({ "POST /v1/documents": () => ({ status: 201, body: { id: 42, finalized: false } }) })
    const id = await clientFor(fake).createDocument({
      documentTypeId: 3,
      customerId: 9,
      title: "Commande ABCD1234",
      taxIncluded: false,
    })
    expect(id).toBe(42)
    expect(fake.apiCalls()[0].body).toEqual({
      documentTypeId: 3,
      customerId: 9,
      title: "Commande ABCD1234",
      isTaxIncludedMode: false,
    })
  })

  it("adds a billable line with its article inline, in the document's tax mode", async () => {
    const fake = fakeHenrri({
      "GET /v1/documentlinetypes": () => lineTypes,
      "POST /v1/documents/42/lines": () => ({ status: 201, body: { id: 1 } }),
    })
    await clientFor(fake).addLine(
      42,
      { designation: "Tapis de tir", reference: "TAP-1", quantity: 2, unitPrice: 50, vatPct: 20 },
      false,
    )
    expect(fake.apiCalls().at(-1)?.body).toEqual({
      typeId: 12,
      reference: "TAP-1",
      description: "Tapis de tir",
      quantity: 2,
      sellingPriceWithoutTax: 50,
      vatPercent: 20,
      isTaxIncluded: false,
      item: {
        reference: "TAP-1",
        description: "Tapis de tir",
        vatPercent: 20,
        isTaxIncluded: false,
        sellingPriceWithoutTax: 50,
      },
    })
  })

  it("prices the inline article TTC on a tax-included document", async () => {
    const fake = fakeHenrri({
      "GET /v1/documentlinetypes": () => lineTypes,
      "POST /v1/documents/42/lines": () => ({ status: 201, body: { id: 1 } }),
    })
    await clientFor(fake).addLine(
      42,
      { designation: "Remboursement", reference: null, quantity: 1, unitPrice: 96.6, vatPct: 20 },
      true,
    )
    expect(fake.apiCalls().at(-1)?.body).toMatchObject({
      isTaxIncluded: true,
      sellingPriceWithoutTax: 96.6,
      item: { isTaxIncluded: true, sellingPriceWithTax: 96.6 },
    })
  })

  it("reads a document's number, state and Henrri's own total", async () => {
    const fake = fakeHenrri({
      "GET /v1/documents/42": () => ({
        status: 200,
        body: { id: 42, identity: "F-2026-0007", finalized: true, priceAfterTax: 1336, lines: [] },
      }),
    })
    expect(await clientFor(fake).getDocument(42)).toEqual({
      id: 42,
      number: "F-2026-0007",
      finalized: true,
      totalTtc: 1336,
    })
  })

  it("returns null for a document Henrri does not know", async () => {
    const fake = fakeHenrri({})
    expect(await clientFor(fake).getDocument(42)).toBeNull()
  })

  it("finalizes a document and returns its definitive number", async () => {
    const fake = fakeHenrri({
      "POST /v1/documents/42/finalize": () => ({
        status: 200,
        body: { id: 42, identity: "F-2026-0008", finalized: true, priceAfterTax: 10 },
      }),
    })
    expect(await clientFor(fake).finalizeDocument(42)).toEqual({
      id: 42,
      number: "F-2026-0008",
      finalized: true,
      totalTtc: 10,
    })
  })

  it("deletes a draft", async () => {
    const fake = fakeHenrri({ "DELETE /v1/documents/42": () => ({ status: 204 }) })
    await clientFor(fake).deleteDocument(42)
    expect(fake.apiCalls()[0]).toMatchObject({ method: "DELETE", path: "/v1/documents/42" })
  })

  it("asks for a temporary PDF link", async () => {
    const fake = fakeHenrri({
      "POST /v1/documents/42/pdf/url": () => ({
        status: 200,
        body: { downloadUrl: "https://henrri.test/files/abc", expiresAt: "2026-10-14T20:10:00Z", fileName: "F.pdf" },
      }),
    })
    expect(await clientFor(fake).pdfLink(42)).toEqual({
      url: "https://henrri.test/files/abc",
      expiresAt: "2026-10-14T20:10:00Z",
      fileName: "F.pdf",
    })
  })
})

describe("Henrri client — customers", () => {
  const buyer = {
    firstName: "Jean",
    lastName: "Tireur",
    email: "jean@example.test",
    address: { line1: "1 rue du Tir", line2: null, postal: "75001", city: "Paris", country: "FR" },
  }

  it("creates an individual customer with a single contact and the billing address", async () => {
    const fake = fakeHenrri({ "POST /v1/customers": () => ({ status: 201, body: { id: 9 } }) })
    expect(await clientFor(fake).createCustomer(buyer)).toBe(9)
    expect(fake.apiCalls()[0].body).toEqual({
      name: "Jean Tireur",
      type: "individual",
      contacts: [{ firstName: "Jean", lastName: "Tireur", email: "jean@example.test", isPrimary: true }],
      address: { address: "1 rue du Tir", postCode: "75001", city: "Paris", country: "France" },
    })
  })

  it("keeps the second address line", async () => {
    const fake = fakeHenrri({ "POST /v1/customers": () => ({ status: 201, body: { id: 9 } }) })
    await clientFor(fake).createCustomer({ ...buyer, address: { ...buyer.address, line2: "Bâtiment B" } })
    expect(fake.apiCalls()[0].body).toMatchObject({ address: { address: "1 rue du Tir\nBâtiment B" } })
  })

  it("updates the name and billing address of an existing customer, never its contacts", async () => {
    const fake = fakeHenrri({ "PUT /v1/customers/9": () => ({ status: 200, body: { id: 9 } }) })
    await clientFor(fake).updateCustomer(9, buyer)
    const body = fake.apiCalls()[0].body as Record<string, unknown>
    expect(body).toMatchObject({ id: 9, name: "Jean Tireur", type: "individual" })
    expect(body).not.toHaveProperty("contacts")
  })
})

describe("henrriClientFromConfig", () => {
  const complete = { baseUrl: BASE_URL, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }

  it("builds a client when Henrri is configured", () => {
    expect(henrriClientFromConfig(complete)).not.toBeNull()
  })

  it.each([
    ["the base URL", { ...complete, baseUrl: undefined }],
    ["the client id", { ...complete, clientId: "" }],
    ["the client secret", { ...complete, clientSecret: "  " }],
  ])("returns null without %s, so invoices simply wait", (_missing, config) => {
    expect(henrriClientFromConfig(config)).toBeNull()
  })
})
