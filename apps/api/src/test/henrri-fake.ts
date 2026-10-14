// An in-memory Henrri for tests (story 12.6), behaving as the sandbox did on
// 2026-10-14: VAT by rate, half a cent up; a number given at finalization; one
// payment milestone per document, a partial payment carrying the rest over.

import { computeVatTotals } from "@armurier/shared"
import type { HenrriBuyer, HenrriClient, HenrriDocument, HenrriMilestone, HenrriPayment } from "../henrri/client.js"
import { HenrriError } from "../henrri/client.js"
import type { DraftLine } from "../henrri/documents.js"

interface FakeDocument {
  id: number
  documentTypeId: number
  customerId: number
  title: string
  lines: DraftLine[]
  finalized: boolean
  number: string | null
  milestones: Array<HenrriMilestone & { paymentModeId: number | null }>
}

type Method = keyof HenrriClient

export const FAKE_TYPES = { invoice: 1, creditNote: 2 } as const
export const FAKE_MODES = { bankCard: 3, transfer: 4 } as const

export function createFakeHenrri() {
  const customers = new Map<number, HenrriBuyer>()
  const documents = new Map<number, FakeDocument>()
  const failures = new Map<Method, HenrriError[]>()
  const calls: Method[] = []
  let nextId = 100
  let sequence = 0
  /** Added to every document total, to simulate Henrri disagreeing with us. */
  let totalSkew = 0

  function track(method: Method) {
    calls.push(method)
    const queued = failures.get(method)
    const failure = queued?.shift()
    if (failure) throw failure
  }

  function documentOf(id: number): FakeDocument {
    const document = documents.get(id)
    if (!document) throw new HenrriError("NotFound", 404, `No document ${id}`)
    return document
  }

  function totalOf(document: FakeDocument): number {
    const totals = computeVatTotals(
      document.lines.map((line) => ({ priceHt: line.unitPrice * line.quantity, vatPct: line.vatPct })),
    )
    return Math.round((totals.totalTtc + totalSkew) * 100) / 100
  }

  function view(document: FakeDocument): HenrriDocument {
    return { id: document.id, number: document.number, finalized: document.finalized, totalTtc: totalOf(document) }
  }

  const client: HenrriClient = {
    async documentTypeId(kind) {
      track("documentTypeId")
      return FAKE_TYPES[kind]
    },
    async createCustomer(buyer) {
      track("createCustomer")
      nextId += 1
      customers.set(nextId, buyer)
      return nextId
    },
    async updateCustomer(customerId, buyer) {
      track("updateCustomer")
      customers.set(customerId, buyer)
    },
    async createDocument(input) {
      track("createDocument")
      nextId += 1
      documents.set(nextId, { id: nextId, ...input, lines: [], finalized: false, number: null, milestones: [] })
      return nextId
    },
    async addLine(documentId, line) {
      track("addLine")
      const document = documentOf(documentId)
      if (document.finalized) throw new HenrriError("DOCUMENT_FINALIZED", 400, "Finalized")
      document.lines.push(line)
    },
    async getDocument(documentId) {
      track("getDocument")
      const document = documents.get(documentId)
      return document ? view(document) : null
    },
    async deleteDocument(documentId) {
      track("deleteDocument")
      const document = documentOf(documentId)
      if (document.finalized) throw new HenrriError("ACCOUNTING_DOCUMENT", 400, "Finalized documents stay")
      documents.delete(documentId)
    },
    async finalizeDocument(documentId) {
      track("finalizeDocument")
      const document = documentOf(documentId)
      if (document.lines.length === 0) throw new HenrriError("LINES_MISSING", 400, "No lines")
      sequence += 1
      document.finalized = true
      document.number = `26-10-${sequence}`
      nextId += 1
      document.milestones = [{ id: nextId, amount: totalOf(document), paid: false, paymentModeId: null }]
      return view(document)
    },
    async pdf(documentId) {
      track("pdf")
      const document = documentOf(documentId)
      return new TextEncoder().encode(`%PDF fake ${document.number ?? "draft"}`)
    },
    async pdfLink(documentId) {
      track("pdfLink")
      return { url: `https://henrri.test/files/${documentId}`, expiresAt: "2026-10-14T20:10:00Z", fileName: "F.pdf" }
    },
    async paymentModeId(type) {
      track("paymentModeId")
      return FAKE_MODES[type]
    },
    async paymentMilestones(documentId) {
      track("paymentMilestones")
      return documentOf(documentId).milestones.map(({ id, amount, paid }) => ({ id, amount, paid }))
    },
    async payMilestone(milestoneId: number, payment: HenrriPayment) {
      track("payMilestone")
      for (const document of documents.values()) {
        const milestone = document.milestones.find((candidate) => candidate.id === milestoneId)
        if (!milestone) continue
        if (milestone.paid) throw new HenrriError("MILESTONE_ALREADY_PAID", 400, "Paid")
        const paid = payment.amount ?? milestone.amount
        const rest = Math.round((milestone.amount - paid) * 100) / 100
        milestone.amount = paid
        milestone.paid = true
        milestone.paymentModeId = payment.paymentModeId
        if (rest > 0) {
          nextId += 1
          document.milestones.push({ id: nextId, amount: rest, paid: false, paymentModeId: null })
        }
        return
      }
      throw new HenrriError("NotFound", 404, `No milestone ${milestoneId}`)
    },
  }

  return {
    client,
    customers,
    documents,
    calls,
    /** The next call to `method` fails with `error`. */
    failNext(method: Method, error: HenrriError) {
      failures.set(method, [...(failures.get(method) ?? []), error])
    },
    skewTotals(by: number) {
      totalSkew = by
    },
    finalizedDocuments() {
      return [...documents.values()].filter((document) => document.finalized)
    },
  }
}

export type FakeHenrri = ReturnType<typeof createFakeHenrri>
