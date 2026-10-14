// Story 12.6 — HTTP client for the Henrri API (contract: docs/henrri/openapi-v1.json).
// Holds the short-lived JWT in memory and renews it before it expires. Neither the
// client secret nor the token ever reaches an error message or a log.

import type { DraftArticle, DraftLine } from "./documents.js"

export type HenrriDocumentKind = "invoice" | "creditNote"

export interface HenrriDocument {
  id: number
  /** The definitive number, set by Henrri at finalization. */
  number: string | null
  finalized: boolean
  /** Henrri's own TTC total, compared to ours before finalizing. */
  totalTtc: number
}

export interface HenrriBuyer {
  firstName: string
  lastName: string
  email: string
  address: { line1: string; line2: string | null; postal: string; city: string; country: string }
}

export type HenrriPaymentModeType = "bankCard" | "transfer"

export interface HenrriMilestone {
  id: number
  amount: number
  paid: boolean
}

export interface HenrriPayment {
  paymentModeId: number
  /** yyyy-MM-dd */
  date: string
  /** Less than the milestone: the remainder becomes a new milestone due the same day. */
  amount?: number
}

export interface HenrriPdfLink {
  url: string
  expiresAt: string
  fileName: string | null
}

export interface HenrriClientOptions {
  baseUrl: string
  clientId: string
  clientSecret: string
  fetchImpl?: typeof fetch
  /** Milliseconds clock, injectable for tests. */
  now?: () => number
}

/**
 * A failed Henrri call. `code` is Henrri's business error code (e.g.
 * `LINES_MISSING`) when it sent one, otherwise a local code. `retryable` tells
 * the queue whether trying again later can help.
 */
export class HenrriError extends Error {
  constructor(
    readonly code: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message)
    this.name = "HenrriError"
  }

  get retryable(): boolean {
    if (this.status === null) return true
    return this.status === 429 || this.status >= 500
  }
}

// Renew this long before Henrri's expiry, so a token never dies mid-request.
const TOKEN_RENEWAL_MARGIN_MS = 60_000
const BUSINESS_ERROR_CODE = /^[A-Z][A-Z0-9_]+$/
const COUNTRY_NAMES = new Intl.DisplayNames(["fr"], { type: "region" })

interface CachedToken {
  value: string
  expiresAt: number
}

interface ProblemDetails {
  errorCode?: string | null
  title?: string | null
  detail?: string | null
  /** ASP.NET validation failures: field → messages. */
  errors?: Record<string, string[]> | null
}

interface RawDocument {
  id: number
  identity?: string | null
  finalized?: boolean
  priceAfterTax?: number
}

interface ListResponse<T> {
  elements: T[] | null
}

function toDocument(raw: RawDocument): HenrriDocument {
  return {
    id: raw.id,
    number: raw.identity ?? null,
    finalized: raw.finalized === true,
    totalTtc: raw.priceAfterTax ?? 0,
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function errorFrom(status: number, body: unknown): HenrriError {
  const problem = (body ?? {}) as ProblemDetails
  if (problem.errors && Object.keys(problem.errors).length > 0) {
    const fields = Object.entries(problem.errors).map(([field, messages]) => `${field}: ${messages.join(" ")}`)
    return new HenrriError("ValidationError", status, [problem.title, ...fields].filter(Boolean).join(" "))
  }
  const candidate = problem.errorCode ?? ""
  const code = BUSINESS_ERROR_CODE.test(candidate) ? candidate : `Http${status}`
  const message = problem.detail ?? problem.title ?? `Henrri answered ${status}`
  return new HenrriError(code, status, message)
}

function customerBody(buyer: HenrriBuyer) {
  const { address } = buyer
  return {
    name: `${buyer.firstName} ${buyer.lastName}`,
    type: "individual",
    address: {
      address: address.line2 ? `${address.line1}\n${address.line2}` : address.line1,
      postCode: address.postal,
      city: address.city,
      country: COUNTRY_NAMES.of(address.country) ?? address.country,
    },
  }
}

function lineBody(typeId: number, itemId: number, line: DraftLine) {
  // The line keeps its own text, price and VAT rate whatever the article says
  // (checked on the sandbox, 2026-10-14). Always HT: Henrri's tax-included mode
  // reads the price as HT anyway through the API.
  return {
    typeId,
    itemId,
    description: line.designation,
    quantity: line.quantity,
    sellingPriceWithoutTax: line.unitPrice,
    vatPercent: line.vatPct,
    isTaxIncluded: false,
  }
}

/** A cached lookup that is dropped when it fails, so the next call asks again. */
function forgetOnFailure<T>(lookup: Promise<T>, forget: () => void): Promise<T> {
  return lookup.catch((error: unknown) => {
    forget()
    throw error
  })
}

export function createHenrriClient(options: HenrriClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "")
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? Date.now

  let token: CachedToken | null = null
  let pendingToken: Promise<CachedToken> | null = null
  let documentTypes: Promise<Map<string, number>> | null = null
  let itemLineTypeId: Promise<number> | null = null
  let productCategoryId: Promise<number> | null = null
  let paymentModes: Promise<Map<string, number>> | null = null
  const articleIds = new Map<string, Promise<number>>()

  async function send(
    method: string,
    path: string,
    body: unknown,
    bearer: string | null,
    accept = "application/json",
  ): Promise<Response> {
    const headers: Record<string, string> = { accept }
    if (body !== undefined) headers["content-type"] = "application/json"
    if (bearer) headers.authorization = `Bearer ${bearer}`
    try {
      return await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new HenrriError("NetworkError", null, `Henrri unreachable (${method} ${path})`)
    }
  }

  async function authenticate(): Promise<CachedToken> {
    const response = await send(
      "POST",
      "/v1/users/authenticate",
      { clientId: options.clientId, clientSecret: options.clientSecret },
      null,
    )
    if (response.status === 401 || response.status === 403) {
      throw new HenrriError("AuthenticationFailed", response.status, "Henrri refused the API credentials")
    }
    const body = (await readJson(response)) as { access_token?: string; expires_in?: number } | null
    if (!response.ok || !body?.access_token) throw errorFrom(response.status, body)
    return { value: body.access_token, expiresAt: now() + (body.expires_in ?? 600) * 1000 }
  }

  async function validToken(): Promise<string> {
    if (token && now() < token.expiresAt - TOKEN_RENEWAL_MARGIN_MS) return token.value
    pendingToken ??= authenticate().finally(() => {
      pendingToken = null
    })
    token = await pendingToken
    return token.value
  }

  /** Sends with the bearer token, renewing it once if Henrri rejects it. */
  async function authorized(method: string, path: string, body?: unknown, accept?: string): Promise<Response> {
    const response = await send(method, path, body, await validToken(), accept)
    if (response.status !== 401) return response
    token = null
    return send(method, path, body, await validToken(), accept)
  }

  /** Calls the API; `null` on a 404, so callers can tell "gone" from "failed". */
  async function call<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    const response = await authorized(method, path, body)
    if (response.status === 404) return null
    const payload = await readJson(response)
    if (!response.ok) throw errorFrom(response.status, payload)
    return payload as T
  }

  async function required<T>(method: string, path: string, body?: unknown): Promise<T> {
    const result = await call<T>(method, path, body)
    if (result === null) throw new HenrriError("NotFound", 404, `Henrri has no ${path}`)
    return result
  }

  async function loadDocumentTypes(): Promise<Map<string, number>> {
    const list = await required<ListResponse<{ id: number; documentKind: string }>>("GET", "/v1/documenttypes")
    return new Map((list.elements ?? []).map((type) => [type.documentKind, type.id]))
  }

  async function loadItemLineTypeId(): Promise<number> {
    const list = await required<ListResponse<{ id: number; type: string }>>("GET", "/v1/documentlinetypes")
    const itemType = (list.elements ?? []).find((type) => type.type === "item")
    if (!itemType) throw new HenrriError("MissingLineType", null, "Henrri lists no billable line type")
    return itemType.id
  }

  async function loadProductCategoryId(): Promise<number> {
    const list = await required<
      ListResponse<{ id: number; isDefault?: boolean; type?: { itemCategoryKind?: string } }>
    >("GET", "/v1/itemcategories")
    const products = (list.elements ?? []).filter((category) => category.type?.itemCategoryKind === "product")
    const category = products.find((candidate) => candidate.isDefault) ?? products[0]
    if (!category) throw new HenrriError("MissingItemCategory", null, "Henrri lists no product category")
    return category.id
  }

  /** Henrri's search is fuzzy: only an exact reference match counts. */
  async function findArticle(reference: string): Promise<number | null> {
    const list = await required<ListResponse<{ id: number; reference: string | null }>>(
      "GET",
      `/v1/items?search=${encodeURIComponent(reference)}`,
    )
    return (list.elements ?? []).find((item) => item.reference === reference)?.id ?? null
  }

  async function createArticle(article: DraftArticle, line: DraftLine): Promise<number> {
    productCategoryId ??= forgetOnFailure(loadProductCategoryId(), () => {
      productCategoryId = null
    })
    try {
      const created = await required<{ id: number }>("POST", "/v1/items", {
        reference: article.reference,
        description: article.description,
        vatPercent: line.vatPct,
        isTaxIncluded: false,
        sellingPriceWithoutTax: line.unitPrice,
        itemCategoryId: await productCategoryId,
      })
      return created.id
    } catch (error) {
      // Another process created it in the meantime: Henrri never reuses an
      // article given inline, it refuses the duplicate.
      if (!(error instanceof HenrriError) || error.code !== "ITEM_DUPLICATE") throw error
      const existing = await findArticle(article.reference)
      if (existing === null) throw error
      return existing
    }
  }

  /** The article id, found or created once per process for each reference. */
  function articleId(line: DraftLine): Promise<number> {
    const { article } = line
    let pending = articleIds.get(article.reference)
    if (!pending) {
      pending = forgetOnFailure(
        findArticle(article.reference).then((found) => found ?? createArticle(article, line)),
        () => articleIds.delete(article.reference),
      )
      articleIds.set(article.reference, pending)
    }
    return pending
  }

  return {
    async documentTypeId(kind: HenrriDocumentKind): Promise<number> {
      documentTypes ??= forgetOnFailure(loadDocumentTypes(), () => {
        documentTypes = null
      })
      const id = (await documentTypes).get(kind)
      if (id === undefined) throw new HenrriError("MissingDocumentType", null, `Henrri lists no ${kind} type`)
      return id
    },

    async createCustomer(buyer: HenrriBuyer): Promise<number> {
      const created = await required<{ id: number }>("POST", "/v1/customers", {
        ...customerBody(buyer),
        contacts: [{ firstName: buyer.firstName, lastName: buyer.lastName, email: buyer.email, isPrimary: true }],
      })
      return created.id
    },

    /** Contacts cannot travel in a customer PUT (Henrri: PUT_WITH_CUSTOMER). */
    async updateCustomer(customerId: number, buyer: HenrriBuyer): Promise<void> {
      await required("PUT", `/v1/customers/${customerId}`, { id: customerId, ...customerBody(buyer) })
    },

    async createDocument(input: { documentTypeId: number; customerId: number; title: string }): Promise<number> {
      const created = await required<RawDocument>("POST", "/v1/documents", {
        documentTypeId: input.documentTypeId,
        customerId: input.customerId,
        title: input.title,
        isTaxIncludedMode: false,
      })
      return created.id
    },

    async addLine(documentId: number, line: DraftLine): Promise<void> {
      itemLineTypeId ??= forgetOnFailure(loadItemLineTypeId(), () => {
        itemLineTypeId = null
      })
      const body = lineBody(await itemLineTypeId, await articleId(line), line)
      await required("POST", `/v1/documents/${documentId}/lines`, body)
    },

    async getDocument(documentId: number): Promise<HenrriDocument | null> {
      const raw = await call<RawDocument>("GET", `/v1/documents/${documentId}`)
      return raw ? toDocument(raw) : null
    },

    async deleteDocument(documentId: number): Promise<void> {
      await call("DELETE", `/v1/documents/${documentId}`)
    },

    async finalizeDocument(documentId: number): Promise<HenrriDocument> {
      return toDocument(await required<RawDocument>("POST", `/v1/documents/${documentId}/finalize`))
    },

    async paymentModeId(type: HenrriPaymentModeType): Promise<number> {
      paymentModes ??= forgetOnFailure(
        required<ListResponse<{ id: number; type: string }>>("GET", "/v1/paymentmodes").then(
          (list) => new Map((list.elements ?? []).map((mode) => [mode.type, mode.id])),
        ),
        () => {
          paymentModes = null
        },
      )
      const id = (await paymentModes).get(type)
      if (id === undefined) throw new HenrriError("MissingPaymentMode", null, `Henrri lists no ${type} payment mode`)
      return id
    },

    async paymentMilestones(documentId: number): Promise<HenrriMilestone[]> {
      const list = await required<ListResponse<{ id: number; amount: number | null; isPaid: boolean }>>(
        "GET",
        `/v1/documents/${documentId}/paymentmilestones`,
      )
      return (list.elements ?? []).map((milestone) => ({
        id: milestone.id,
        amount: milestone.amount ?? 0,
        paid: milestone.isPaid,
      }))
    },

    async payMilestone(milestoneId: number, payment: HenrriPayment): Promise<void> {
      const remainder = payment.amount === undefined ? {} : { amount: payment.amount, ecartDueDate: payment.date }
      await required("POST", `/v1/paymentmilestones/${milestoneId}/pay`, {
        paymentModeId: payment.paymentModeId,
        date: payment.date,
        ...remainder,
      })
    },

    /** The document rendered as a PDF, as Henrri locked it at finalization. */
    async pdf(documentId: number): Promise<Uint8Array> {
      const response = await authorized("GET", `/v1/documents/${documentId}/pdf`, undefined, "application/pdf")
      if (!response.ok) throw errorFrom(response.status, await readJson(response))
      return new Uint8Array(await response.arrayBuffer())
    },

    async pdfLink(documentId: number): Promise<HenrriPdfLink> {
      const link = await required<{ downloadUrl: string; expiresAt: string; fileName?: string | null }>(
        "POST",
        `/v1/documents/${documentId}/pdf/url`,
      )
      return { url: link.downloadUrl, expiresAt: link.expiresAt, fileName: link.fileName ?? null }
    },
  }
}

export type HenrriClient = ReturnType<typeof createHenrriClient>

export interface HenrriConfig {
  baseUrl?: string
  clientId?: string
  clientSecret?: string
}

/** The client, or null while Henrri is not configured: invoices then wait in the queue. */
export function henrriClientFromConfig(config: HenrriConfig): HenrriClient | null {
  const baseUrl = config.baseUrl?.trim()
  const clientId = config.clientId?.trim()
  const clientSecret = config.clientSecret?.trim()
  if (!baseUrl || !clientId || !clientSecret) return null
  return createHenrriClient({ baseUrl, clientId, clientSecret })
}
