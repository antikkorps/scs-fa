// An in-memory Henrri for tests (story 12.6), behaving as the sandbox did on
// 2026-10-14: VAT by rate, half a cent up; a number given at finalization; one
// payment milestone per document, a partial payment carrying the rest over.

import { computeVatTotals } from "@armurier/shared"
import type {
  HenrriClient,
  HenrriCustomer,
  HenrriDocument,
  HenrriMilestone,
  HenrriPayment,
  HenrriQuoteSigner,
} from "../henrri/client.js"
import { HenrriError } from "../henrri/client.js"
import type { DraftLine } from "../henrri/documents.js"

interface FakeDocument {
  id: number
  documentTypeId: number
  customerId: number
  title: string
  lines: DraftLine[]
  dueLabel: string | null
  validatedBy: HenrriQuoteSigner | null
  finalized: boolean
  number: string | null
  milestones: Array<HenrriMilestone & { paymentModeId: number | null; date: string | null }>
}

type Method = keyof HenrriClient

export const FAKE_TYPES = { invoice: 1, creditNote: 2, quotation: 5 } as const
export const FAKE_MODES = { bankCard: 3, transfer: 4 } as const

export function createFakeHenrri() {
  const customers = new Map<number, HenrriCustomer>()
  const documents = new Map<number, FakeDocument>()
  const failures = new Map<Method, HenrriError[]>()
  const hooks = new Map<Method, Array<() => Promise<void>>>()
  let withheldNumbers = 0
  const calls: Method[] = []
  let nextId = 100
  let sequence = 0
  /** Added to every document total, to simulate Henrri disagreeing with us. */
  let totalSkew = 0

  async function track(method: Method) {
    calls.push(method)
    const hook = hooks.get(method)?.shift()
    if (hook) await hook()
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
      await track("documentTypeId")
      return FAKE_TYPES[kind]
    },
    async createCustomer(buyer) {
      await track("createCustomer")
      nextId += 1
      customers.set(nextId, buyer)
      return nextId
    },
    async updateCustomer(customerId, buyer) {
      await track("updateCustomer")
      if (!customers.has(customerId)) throw new HenrriError("NotFound", 404, `No customer ${customerId}`)
      customers.set(customerId, buyer)
    },
    async createDocument(input) {
      await track("createDocument")
      nextId += 1
      documents.set(nextId, {
        id: nextId,
        ...input,
        lines: [],
        dueLabel: null,
        validatedBy: null,
        finalized: false,
        number: null,
        milestones: [],
      })
      return nextId
    },
    async addLine(documentId, line) {
      await track("addLine")
      const document = documentOf(documentId)
      if (document.finalized) throw new HenrriError("DOCUMENT_FINALIZED", 400, "Finalized")
      document.lines.push(line)
    },
    async getDocument(documentId) {
      await track("getDocument")
      const document = documents.get(documentId)
      return document ? view(document) : null
    },
    async deleteDocument(documentId) {
      await track("deleteDocument")
      // The real client ignores a 404: deleting what is already gone is fine.
      const document = documents.get(documentId)
      if (!document) return
      if (document.finalized) throw new HenrriError("ACCOUNTING_DOCUMENT", 400, "Finalized documents stay")
      documents.delete(documentId)
    },
    async finalizeDocument(documentId) {
      await track("finalizeDocument")
      const document = documentOf(documentId)
      if (document.lines.length === 0) throw new HenrriError("LINES_MISSING", 400, "No lines")
      sequence += 1
      document.finalized = true
      document.number = `26-10-${sequence}`
      if (withheldNumbers > 0) {
        withheldNumbers -= 1
        return { ...view(document), number: null }
      }
      nextId += 1
      document.milestones = [{ id: nextId, amount: totalOf(document), paid: false, paymentModeId: null, date: null }]
      return view(document)
    },
    async validateQuotation(documentId, signer) {
      await track("validateQuotation")
      const document = documentOf(documentId)
      if (!document.finalized) throw new HenrriError("DOCUMENT_NOT_FINALIZED", 400, "Draft")
      document.validatedBy = signer
    },
    async setPaymentTermsLabel(documentId, label) {
      await track("setPaymentTermsLabel")
      const document = documentOf(documentId)
      if (document.finalized) throw new HenrriError("DOCUMENT_FINALIZED", 400, "Finalized")
      document.dueLabel = label
    },
    async pdf(documentId) {
      await track("pdf")
      const document = documentOf(documentId)
      return new TextEncoder().encode(`%PDF fake ${document.number ?? "draft"}`)
    },
    async paymentModeId(type) {
      await track("paymentModeId")
      return FAKE_MODES[type]
    },
    async paymentMilestones(documentId) {
      await track("paymentMilestones")
      return documentOf(documentId).milestones.map(({ id, amount, paid }) => ({ id, amount, paid }))
    },
    async payMilestone(milestoneId: number, payment: HenrriPayment) {
      await track("payMilestone")
      for (const document of documents.values()) {
        const milestone = document.milestones.find((candidate) => candidate.id === milestoneId)
        if (!milestone) continue
        if (milestone.paid) throw new HenrriError("MILESTONE_ALREADY_PAID", 400, "Paid")
        if (payment.amount !== undefined && payment.amount > milestone.amount) {
          // As the sandbox answers an overpayment without a retention type.
          throw new HenrriError("ECART_RETENTION_TYPE_REQUIRED", 400, "Retention type required")
        }
        const paid = payment.amount ?? milestone.amount
        const rest = Math.round((milestone.amount - paid) * 100) / 100
        milestone.amount = paid
        milestone.paid = true
        milestone.paymentModeId = payment.paymentModeId
        milestone.date = payment.date
        if (rest > 0) {
          nextId += 1
          document.milestones.push({ id: nextId, amount: rest, paid: false, paymentModeId: null, date: null })
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
    /** Runs `hook` when `method` is next called, before it answers (e.g. another pass taking over). */
    beforeNext(method: Method, hook: () => Promise<void>) {
      hooks.set(method, [...(hooks.get(method) ?? []), hook])
    },
    /** The next finalization answers without the number (Henrri still assigned one). */
    withholdNextNumber() {
      withheldNumbers += 1
    },
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
