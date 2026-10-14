// Story 12.6 — HTTP client for the Henrri API (contract: docs/henrri/openapi-v1.json).
// Holds the short-lived JWT in memory and renews it before it expires. Neither the
// client secret nor the token ever reaches an error message or a log.

import type { DraftLine } from "./documents.js"

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
  type?: string | null
  code?: string | null
  title?: string | null
  detail?: string | null
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
  const candidate = problem.code ?? problem.type ?? ""
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

function lineBody(typeId: number, line: DraftLine, taxIncluded: boolean) {
  const price = taxIncluded ? { sellingPriceWithTax: line.unitPrice } : { sellingPriceWithoutTax: line.unitPrice }
  return {
    typeId,
    reference: line.reference,
    description: line.designation,
    quantity: line.quantity,
    // On a tax-included document Henrri reads this price as TTC (see `isTaxIncluded`).
    sellingPriceWithoutTax: line.unitPrice,
    vatPercent: line.vatPct,
    isTaxIncluded: taxIncluded,
    // Henrri bills catalog articles only: the article is given inline and Henrri
    // matches it on reference + description (unique across the catalog).
    item: {
      reference: line.reference,
      description: line.designation,
      vatPercent: line.vatPct,
      isTaxIncluded: taxIncluded,
      ...price,
    },
  }
}

export function createHenrriClient(options: HenrriClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "")
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? Date.now

  let token: CachedToken | null = null
  let pendingToken: Promise<CachedToken> | null = null
  let documentTypes: Promise<Map<string, number>> | null = null
  let itemLineTypeId: Promise<number> | null = null

  async function send(method: string, path: string, body: unknown, bearer: string | null): Promise<Response> {
    const headers: Record<string, string> = { accept: "application/json" }
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

  /** Calls the API; `null` on a 404, so callers can tell "gone" from "failed". */
  async function call<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    let response = await send(method, path, body, await validToken())
    if (response.status === 401) {
      token = null
      response = await send(method, path, body, await validToken())
    }
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

  return {
    async documentTypeId(kind: HenrriDocumentKind): Promise<number> {
      documentTypes ??= loadDocumentTypes().catch((error: unknown) => {
        documentTypes = null
        throw error
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

    async createDocument(input: {
      documentTypeId: number
      customerId: number
      title: string
      taxIncluded: boolean
    }): Promise<number> {
      const created = await required<RawDocument>("POST", "/v1/documents", {
        documentTypeId: input.documentTypeId,
        customerId: input.customerId,
        title: input.title,
        isTaxIncludedMode: input.taxIncluded,
      })
      return created.id
    },

    async addLine(documentId: number, line: DraftLine, taxIncluded: boolean): Promise<void> {
      itemLineTypeId ??= loadItemLineTypeId().catch((error: unknown) => {
        itemLineTypeId = null
        throw error
      })
      await required("POST", `/v1/documents/${documentId}/lines`, lineBody(await itemLineTypeId, line, taxIncluded))
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
