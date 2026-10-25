// Story 12.6 — HTTP client for the Henrri API (contract: docs/henrri/openapi-v1.json).
// Holds the short-lived JWT in memory and renews it before it expires. Neither the
// client secret nor the token ever reaches an error message or a log.

import type { DraftArticle, DraftLine } from "./documents.js"

export type HenrriDocumentKind = "invoice" | "creditNote" | "quotation"

export interface HenrriDocument {
  id: number
  /** The definitive number, set by Henrri at finalization. */
  number: string | null
  finalized: boolean
  /** Henrri's own TTC total, compared to ours before finalizing. */
  totalTtc: number
}

export interface HenrriAddress {
  line1: string
  line2: string | null
  postal: string
  city: string
  country: string
}

/** Who the invoice is made out to. No e-mail: not needed on an invoice (decision 2026-10-14). */
export interface HenrriBuyer {
  firstName: string
  lastName: string
  address: HenrriAddress
}

/** A pro's organisation (story 12.8d): its quotes are made out to the company, the requester its contact. */
export interface HenrriCompany {
  companyName: string
  siret: string
  contact: { firstName: string; lastName: string }
  address: HenrriAddress
}

export type HenrriCustomer = HenrriBuyer | HenrriCompany

function isCompany(customer: HenrriCustomer): customer is HenrriCompany {
  return "siret" in customer
}

export type HenrriPaymentModeType = "bankCard" | "transfer"

/** Who accepted a quote (story 12.8d): Henrri records it on the quote as its validation. */
export interface HenrriQuoteSigner {
  email: string
  firstName: string
  lastName: string
  at: Date
  ip: string
}

const PARIS_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Paris",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})

/** Paris' offset from UTC at `at`, in seconds — Henrri asks for it with a validation. */
export function parisOffsetSeconds(at: Date): number {
  const parts = Object.fromEntries(PARIS_PARTS.formatToParts(at).map((part) => [part.type, part.value]))
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 1000)
}

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

export interface HenrriClientOptions {
  baseUrl: string
  clientId: string
  clientSecret: string
  fetchImpl?: typeof fetch
  /** Milliseconds clock, injectable for tests. */
  now?: () => number
  /** Per-call limit: a call that hangs becomes a retryable `Timeout` (default 30 s). */
  timeoutMs?: number
}

/**
 * A failed Henrri call. `code` is Henrri's business error code (e.g.
 * `LINES_MISSING`) when it sent one, otherwise a local code. `retryable` tells
 * the queue whether trying again later can help: Henrri unreachable, slow,
 * rate-limited, out of credits, or refusing our credentials all wait for a later
 * pass; a refusal of the document itself, or a configuration gap on our side
 * (`Missing…`), needs a human.
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
    if (this.code.startsWith("Missing")) return false
    if (this.status === null) return true
    return this.status === 401 || this.status === 403 || this.status === 429 || this.status >= 500
  }
}

// Renew this long before Henrri's expiry, so a token never dies mid-request.
const TOKEN_RENEWAL_MARGIN_MS = 60_000
const BUSINESS_ERROR_CODE = /^[A-Z][A-Z0-9_]+$/
const DEFAULT_TIMEOUT_MS = 30_000
// An invoice PDF weighs tens of kilobytes; anything far beyond is not one.
const MAX_PDF_BYTES = 10 * 1024 * 1024
// Item search is fuzzy and paged: how many pages to read before giving up.
const MAX_SEARCH_PAGES = 10
const COUNTRY_NAMES = new Intl.DisplayNames(["fr"], { type: "region" })

interface CachedToken {
  value: string
  expiresAt: number
}

interface ProblemDetails {
  errorCode?: string | null
  /** The quota refusal uses `code` / `message` instead of the ProblemDetails fields. */
  code?: string | null
  message?: string | null
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
  meta?: { hasNext?: boolean } | null
}

interface TokenBody {
  access_token?: string
  accessToken?: string
  expires_in?: number
  expiresIn?: number
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
  const candidate = problem.errorCode ?? problem.code ?? ""
  const code = BUSINESS_ERROR_CODE.test(candidate) ? candidate : `Http${status}`
  const message = problem.detail ?? problem.message ?? problem.title ?? `Henrri answered ${status}`
  return new HenrriError(code, status, message)
}

function addressBody(address: HenrriAddress) {
  return {
    address: address.line2 ? `${address.line1}\n${address.line2}` : address.line1,
    postCode: address.postal,
    city: address.city,
    country: COUNTRY_NAMES.of(address.country) ?? address.country,
  }
}

function customerBody(customer: HenrriCustomer) {
  if (isCompany(customer)) {
    return {
      name: customer.companyName,
      type: "professional",
      companyIdentifierType: "siret",
      siret: customer.siret,
      address: addressBody(customer.address),
    }
  }
  return {
    name: `${customer.firstName} ${customer.lastName}`,
    type: "individual",
    address: addressBody(customer.address),
  }
}

function primaryContact(customer: HenrriCustomer) {
  const { firstName, lastName } = isCompany(customer) ? customer.contact : customer
  return { firstName, lastName, isPrimary: true }
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
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

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
    const signal = AbortSignal.timeout(timeoutMs)
    try {
      return await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      })
    } catch {
      if (signal.aborted) throw new HenrriError("Timeout", null, `Henrri took over ${timeoutMs} ms (${method} ${path})`)
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
    // The quickstart answers in snake_case, the spec's schema in camelCase: take either.
    const body = (await readJson(response)) as TokenBody | null
    const value = body?.access_token ?? body?.accessToken
    if (!response.ok || !value) throw errorFrom(response.status, body)
    return { value, expiresAt: now() + (body?.expires_in ?? body?.expiresIn ?? 600) * 1000 }
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

  /**
   * A call whose answer carries nothing to read: success is its status alone.
   * Henrri answers some of them 200 with an empty body (quote validation,
   * sandbox 2026-10-25), which `required` would mistake for "not found".
   */
  async function command(method: string, path: string, body?: unknown): Promise<void> {
    const response = await authorized(method, path, body)
    if (response.status === 404) throw new HenrriError("NotFound", 404, `Henrri has no ${path}`)
    if (!response.ok) throw errorFrom(response.status, await readJson(response))
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

  /**
   * Henrri's search is fuzzy and paged: "PORT" also matches "SUPPORT", "TRANSPORT"…
   * Only an exact reference counts, possibly beyond the first page.
   */
  async function findArticle(reference: string): Promise<number | null> {
    for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
      const list = await required<ListResponse<{ id: number; reference: string | null }>>(
        "GET",
        `/v1/items?search=${encodeURIComponent(reference)}&limit=100&page=${page}`,
      )
      const match = (list.elements ?? []).find((item) => item.reference === reference)
      if (match) return match.id
      if (!list.meta?.hasNext) return null
    }
    return null
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

    async createCustomer(customer: HenrriCustomer): Promise<number> {
      const created = await required<{ id: number }>("POST", "/v1/customers", {
        ...customerBody(customer),
        contacts: [primaryContact(customer)],
      })
      return created.id
    },

    /**
     * A customer PUT replaces the whole record, so the stored one is read first and
     * only the name, SIRET and address change: what the accountant set in Henrri (account
     * number, VAT number, comment…) is kept. Contacts cannot travel in a PUT
     * (PUT_WITH_CUSTOMER), nor links.
     */
    async updateCustomer(customerId: number, customer: HenrriCustomer): Promise<void> {
      const {
        contacts: _contacts,
        links: _links,
        ...stored
      } = await required<Record<string, unknown>>("GET", `/v1/customers/${customerId}`)
      // Henrri reads empty fields back ("" for a VAT number) but refuses to write
      // them (sandbox, 2026-10-14): only the filled ones are sent back.
      const filled = Object.fromEntries(Object.entries(stored).filter(([, value]) => value !== "" && value !== null))
      await required("PUT", `/v1/customers/${customerId}`, { ...filled, id: customerId, ...customerBody(customer) })
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

    /** The quote accepted by its signer: Henrri's "validation" (2 credits). */
    async validateQuotation(documentId: number, signer: HenrriQuoteSigner): Promise<void> {
      await command("POST", `/v1/documents/${documentId}/validate`, {
        email: signer.email,
        firstName: signer.firstName,
        lastName: signer.lastName,
        validationDate: signer.at.toISOString(),
        timeOffset: parisOffsetSeconds(signer.at),
        ip: signer.ip,
      })
    },

    /** A custom payment-terms text on a draft (a finalized document cannot change). */
    async setPaymentTermsLabel(documentId: number, label: string): Promise<void> {
      await command("PUT", `/v1/documents/${documentId}/paymenttermsdisplay`, {
        showAmounts: true,
        showPercentages: false,
        showConditions: true,
        showDueDates: true,
        dueLabel: label,
      })
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
      if (Number(response.headers.get("content-length") ?? 0) > MAX_PDF_BYTES) {
        throw new HenrriError("PdfTooLarge", response.status, "Henrri sent a PDF far larger than an invoice")
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength > MAX_PDF_BYTES) {
        throw new HenrriError("PdfTooLarge", response.status, "Henrri sent a PDF far larger than an invoice")
      }
      return bytes
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
