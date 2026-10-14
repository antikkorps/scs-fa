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
const itemCategories = {
  status: 200,
  body: {
    elements: [
      { id: 2223, label: "Services", isDefault: true, type: { itemCategoryKind: "service" } },
      { id: 2222, label: "Produits", isDefault: true, type: { itemCategoryKind: "product" } },
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
    // Retryable: a rotated or mistyped secret must leave the queue waiting, not block it (audit 2026-10-14).
    expect(error).toMatchObject({ code: "AuthenticationFailed", status: 401, retryable: true })
    expect(JSON.stringify(error)).not.toContain(CLIENT_SECRET)
    expect(String((error as Error).message)).not.toContain(CLIENT_SECRET)
  })
})

describe("Henrri client — errors", () => {
  it("surfaces Henrri's business error code, not retryable", async () => {
    const fake = fakeHenrri({
      "POST /v1/documents/5/finalize": () => ({
        status: 400,
        // As the sandbox answers (2026-10-14): the code travels in `errorCode`.
        body: {
          type: "https://api-sandbox.henrri.io/scalar/#tag/businesserrors",
          title: "Lines missing",
          status: 400,
          detail: "The document must contain at least one line to be finalized.",
          errorCode: "LINES_MISSING",
        },
      }),
    })
    const error = await clientFor(fake)
      .finalizeDocument(5)
      .catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      code: "LINES_MISSING",
      status: 400,
      retryable: false,
      message: "The document must contain at least one line to be finalized.",
    })
  })

  it("names the fields Henrri's validation refused", async () => {
    const fake = fakeHenrri({
      "POST /v1/documents/5/finalize": () => ({
        status: 400,
        body: {
          title: "One or more validation errors occurred.",
          status: 400,
          errors: { "Item.itemCategoryId": ["If itemCategoryId is null, then itemCategory cannot be null."] },
        },
      }),
    })
    const error = await clientFor(fake)
      .finalizeDocument(5)
      .catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      code: "ValidationError",
      status: 400,
      message:
        "One or more validation errors occurred. Item.itemCategoryId: If itemCategoryId is null, then itemCategory cannot be null.",
    })
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
    })
    expect(id).toBe(42)
    expect(fake.apiCalls()[0].body).toEqual({
      documentTypeId: 3,
      customerId: 9,
      title: "Commande ABCD1234",
      isTaxIncludedMode: false,
    })
  })

  const matLine = {
    designation: "Tapis de tir",
    article: { reference: "TAP-1", description: "Tapis de tir" },
    quantity: 2,
    unitPrice: 50,
    vatPct: 20,
  }

  function catalogRoutes(items: Array<{ id: number; reference: string }>, extra: Record<string, Handler> = {}) {
    return fakeHenrri({
      "GET /v1/documentlinetypes": () => lineTypes,
      "GET /v1/itemcategories": () => itemCategories,
      "GET /v1/items": () => ({ status: 200, body: { elements: items } }),
      "POST /v1/documents/42/lines": () => ({ status: 201, body: { id: 1 } }),
      ...extra,
    })
  }

  it("bills an existing article by its id, with the line's own text, price and VAT", async () => {
    // Henrri's search is fuzzy: only the exact reference counts.
    const fake = catalogRoutes([
      { id: 70, reference: "TAP-10" },
      { id: 71, reference: "TAP-1" },
    ])
    await clientFor(fake).addLine(42, matLine)

    expect(fake.apiCalls().find((call) => call.path.startsWith("/v1/items"))?.path).toBe(
      "/v1/items?search=TAP-1&limit=100&page=1",
    )
    expect(fake.apiCalls().at(-1)?.body).toEqual({
      typeId: 12,
      itemId: 71,
      description: "Tapis de tir",
      quantity: 2,
      sellingPriceWithoutTax: 50,
      vatPercent: 20,
      isTaxIncluded: false,
    })
  })

  it("creates a missing article once, in the default product category", async () => {
    const fake = catalogRoutes([], { "POST /v1/items": () => ({ status: 201, body: { id: 80 } }) })
    const client = clientFor(fake)
    await client.addLine(42, matLine)
    await client.addLine(42, { ...matLine, quantity: 1 })

    const created = fake.apiCalls().filter((call) => call.method === "POST" && call.path === "/v1/items")
    expect(created).toHaveLength(1)
    expect(created[0].body).toEqual({
      reference: "TAP-1",
      description: "Tapis de tir",
      vatPercent: 20,
      isTaxIncluded: false,
      sellingPriceWithoutTax: 50,
      itemCategoryId: 2222,
    })
    expect(fake.apiCalls().filter((call) => call.path.startsWith("/v1/items?"))).toHaveLength(1)
    expect(fake.apiCalls().at(-1)?.body).toMatchObject({ itemId: 80, quantity: 1 })
  })

  it("picks up the article another process created in the meantime", async () => {
    let searches = 0
    const fake = catalogRoutes([], {
      "GET /v1/items": () => {
        searches += 1
        return { status: 200, body: { elements: searches === 1 ? [] : [{ id: 90, reference: "TAP-1" }] } }
      },
      "POST /v1/items": () => ({
        status: 400,
        body: { title: "Item already exists", status: 400, errorCode: "ITEM_DUPLICATE" },
      }),
    })
    await clientFor(fake).addLine(42, matLine)
    expect(fake.apiCalls().at(-1)?.body).toMatchObject({ itemId: 90 })
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
})

describe("Henrri client — customers", () => {
  const buyer = {
    firstName: "Jean",
    lastName: "Tireur",
    address: { line1: "1 rue du Tir", line2: null, postal: "75001", city: "Paris", country: "FR" },
  }

  it("creates an individual customer with a single contact and the billing address, without the e-mail", async () => {
    const fake = fakeHenrri({ "POST /v1/customers": () => ({ status: 201, body: { id: 9 } }) })
    expect(await clientFor(fake).createCustomer(buyer)).toBe(9)
    // Decision 2026-10-14: the e-mail is not needed on an invoice, and the site mails the buyer itself.
    expect(fake.apiCalls()[0].body).toEqual({
      name: "Jean Tireur",
      type: "individual",
      contacts: [{ firstName: "Jean", lastName: "Tireur", isPrimary: true }],
      address: { address: "1 rue du Tir", postCode: "75001", city: "Paris", country: "France" },
    })
  })

  it("keeps the second address line", async () => {
    const fake = fakeHenrri({ "POST /v1/customers": () => ({ status: 201, body: { id: 9 } }) })
    await clientFor(fake).createCustomer({ ...buyer, address: { ...buyer.address, line2: "Bâtiment B" } })
    expect(fake.apiCalls()[0].body).toMatchObject({ address: { address: "1 rue du Tir\nBâtiment B" } })
  })

  it("updates only the name and address, keeping what the accountant set in Henrri", async () => {
    // A customer PUT replaces the whole record: read it first, change only our fields.
    const stored = {
      id: 9,
      name: "Jean Ancien",
      type: "individual",
      accountingNumber: "411TIREUR",
      vatNumber: "",
      comment: "Client fidèle",
      address: { id: 5, address: "Ancienne adresse", postCode: "69002", city: "Lyon", country: "France" },
      contacts: [{ id: 3, lastName: "Tireur" }],
      links: [],
    }
    const fake = fakeHenrri({
      "GET /v1/customers/9": () => ({ status: 200, body: stored }),
      "PUT /v1/customers/9": () => ({ status: 200, body: { id: 9 } }),
    })
    await clientFor(fake).updateCustomer(9, buyer)
    const body = fake.apiCalls().find((call) => call.method === "PUT")?.body as Record<string, unknown>
    expect(body).toMatchObject({
      id: 9,
      name: "Jean Tireur",
      type: "individual",
      accountingNumber: "411TIREUR",
      comment: "Client fidèle",
      address: { address: "1 rue du Tir", postCode: "75001", city: "Paris", country: "France" },
    })
    expect(body).not.toHaveProperty("contacts")
    expect(body).not.toHaveProperty("links")
  })
})

describe("Henrri client — resilience (audit 2026-10-14)", () => {
  it("gives up on a call that hangs, as a retryable timeout", async () => {
    const hanging: typeof fetch = (input, init) =>
      new Promise((resolve, reject) => {
        if (new URL(String(input)).pathname === "/v1/users/authenticate") {
          resolve(Response.json({ access_token: "token-1", expires_in: 600 }))
          return
        }
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))
      })
    const client = createHenrriClient({
      baseUrl: BASE_URL,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      fetchImpl: hanging,
      timeoutMs: 20,
    })
    const error = await client.getDocument(5).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: "Timeout", status: null, retryable: true })
  })

  it("reads the monthly quota refusal, retryable", async () => {
    const fake = fakeHenrri({
      "POST /v1/documents/5/finalize": () => ({
        status: 429,
        body: { code: "QUOTA_EXCEEDED", message: "You have exceeded your monthly Quota of 200 API calls." },
      }),
    })
    const error = await clientFor(fake)
      .finalizeDocument(5)
      .catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      code: "QUOTA_EXCEEDED",
      status: 429,
      retryable: true,
      message: "You have exceeded your monthly Quota of 200 API calls.",
    })
  })

  it("treats a refused permission as retryable, so the queue waits for a fix", async () => {
    const fake = fakeHenrri({ "GET /v1/documents/5": () => ({ status: 403 }) })
    const error = await clientFor(fake)
      .getDocument(5)
      .catch((caught: unknown) => caught)
    expect(error).toMatchObject({ status: 403, retryable: true })
  })

  it("never retries a configuration problem on our side", async () => {
    const fake = fakeHenrri({ "GET /v1/paymentmodes": () => ({ status: 200, body: { elements: [] } }) })
    const error = await clientFor(fake)
      .paymentModeId("bankCard")
      .catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: "MissingPaymentMode", retryable: false })
  })

  it("accepts the token in camelCase too, as the spec's schema writes it", async () => {
    const calls: string[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const path = new URL(String(input)).pathname
      if (path === "/v1/users/authenticate") return Response.json({ accessToken: "token-camel", expiresIn: 600 })
      calls.push(new Headers(init?.headers).get("authorization") ?? "")
      return Response.json({ id: 5, finalized: false })
    }
    const client = createHenrriClient({
      baseUrl: BASE_URL,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      fetchImpl,
    })
    await client.getDocument(5)
    expect(calls).toEqual(["Bearer token-camel"])
  })

  it("finds an article beyond the first page of Henrri's fuzzy search", async () => {
    const fake = fakeHenrri({
      "GET /v1/documentlinetypes": () => lineTypes,
      "GET /v1/items": (call) =>
        call.path.includes("page=1")
          ? { status: 200, body: { elements: [{ id: 1, reference: "SUPPORT" }], meta: { hasNext: true } } }
          : { status: 200, body: { elements: [{ id: 2, reference: "PORT" }], meta: { hasNext: false } } },
      "POST /v1/documents/42/lines": () => ({ status: 201, body: { id: 1 } }),
    })
    await clientFor(fake).addLine(42, {
      designation: "Frais de port",
      article: { reference: "PORT", description: "Frais de port" },
      quantity: 1,
      unitPrice: 20.83,
      vatPct: 20,
    })
    expect(fake.apiCalls().at(-1)?.body).toMatchObject({ itemId: 2 })
  })

  it("refuses a PDF larger than any invoice could be", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      if (new URL(String(input)).pathname === "/v1/users/authenticate") {
        return Response.json({ access_token: "token-1", expires_in: 600 })
      }
      return new Response("x", { status: 200, headers: { "content-length": String(50 * 1024 * 1024) } })
    }
    const client = createHenrriClient({
      baseUrl: BASE_URL,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      fetchImpl,
    })
    const error = await client.pdf(42).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: "PdfTooLarge" })
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

describe("Henrri client — payments", () => {
  it("resolves the card and transfer payment modes by type, asking Henrri once", async () => {
    const fake = fakeHenrri({
      "GET /v1/paymentmodes": () => ({
        status: 200,
        body: {
          elements: [
            { id: 1, type: "cash" },
            { id: 3, type: "bankCard" },
            { id: 4, type: "transfer" },
          ],
        },
      }),
    })
    const client = clientFor(fake)
    expect(await client.paymentModeId("bankCard")).toBe(3)
    expect(await client.paymentModeId("transfer")).toBe(4)
    expect(fake.apiCalls()).toHaveLength(1)
  })

  it("lists a document's payment milestones", async () => {
    const fake = fakeHenrri({
      "GET /v1/documents/42/paymentmilestones": () => ({
        status: 200,
        body: { elements: [{ id: 9, amount: 1336, isPaid: false, documentId: 42 }] },
      }),
    })
    expect(await clientFor(fake).paymentMilestones(42)).toEqual([{ id: 9, amount: 1336, paid: false }])
  })

  it("pays a milestone, carrying any remainder over to a new milestone due the same day", async () => {
    const fake = fakeHenrri({ "POST /v1/paymentmilestones/9/pay": () => ({ status: 201, body: { id: 215 } }) })
    await clientFor(fake).payMilestone(9, { paymentModeId: 3, date: "2026-10-14", amount: 111 })
    expect(fake.apiCalls()[0].body).toEqual({
      paymentModeId: 3,
      date: "2026-10-14",
      amount: 111,
      ecartDueDate: "2026-10-14",
    })
  })

  it("pays a milestone in full when no amount is given", async () => {
    const fake = fakeHenrri({ "POST /v1/paymentmilestones/9/pay": () => ({ status: 201, body: { id: 216 } }) })
    await clientFor(fake).payMilestone(9, { paymentModeId: 4, date: "2026-10-14" })
    expect(fake.apiCalls()[0].body).toEqual({ paymentModeId: 4, date: "2026-10-14" })
  })
})

describe("Henrri client — PDF", () => {
  it("downloads the document's PDF with its name", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7 fake")
    let accept: string | null = null
    const fetchImpl: typeof fetch = async (input, init) => {
      const path = new URL(String(input)).pathname
      if (path === "/v1/users/authenticate") {
        return Response.json({ access_token: "token-1", expires_in: 600 })
      }
      accept = new Headers(init?.headers).get("accept")
      return new Response(bytes, {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": 'attachment; filename="FACTURE 26-10-1 Tireur.pdf"',
        },
      })
    }
    const client = createHenrriClient({
      baseUrl: BASE_URL,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      fetchImpl,
    })
    const pdf = await client.pdf(42)
    expect(accept).toBe("application/pdf")
    expect(new TextDecoder().decode(pdf)).toBe("%PDF-1.7 fake")
  })

  it("fails like any other call when Henrri refuses", async () => {
    const fake = fakeHenrri({ "GET /v1/documents/42/pdf": () => ({ status: 503 }) })
    const error = await clientFor(fake)
      .pdf(42)
      .catch((caught: unknown) => caught)
    expect(error).toMatchObject({ status: 503, retryable: true })
  })
})
