// Story 12.8d — a quote request as the Henrri queue issues it: its priced
// lines and delivery, the organisation it is made out to, and who asked.

import { asc, eq } from "drizzle-orm"
import { db } from "../db/client.js"
import { organisations, quoteRequestItems, quoteRequests, users } from "../db/schema.js"
import { BILLING_ADDRESS_COLUMNS, completeBillingAddress } from "../organisations/service.js"
import type { HenrriCompany, HenrriQuoteSigner } from "./client.js"
import type { QuotationSource } from "./quotations.js"

export interface QuotationContext {
  quoteRequestId: string
  number: string
  validUntil: Date | null
  organisationId: string
  henrriCustomerId: number | null
  henrriCustomerFingerprint: string | null
  /** Null while the organisation has no complete billing address. */
  company: HenrriCompany | null
  /** Null until SCS has set the delivery and frozen the total. */
  source: QuotationSource | null
  requester: { id: string; email: string }
  /** Set once the pro accepted the quote (12.8d-2): Henrri records it as the quote's validation. */
  acceptance: HenrriQuoteSigner | null
}

export async function loadQuotation(quoteRequestId: string): Promise<QuotationContext | null> {
  const [row] = await db
    .select({
      request: quoteRequests,
      legalName: organisations.legalName,
      siret: organisations.siret,
      henrriCustomerId: organisations.henrriCustomerId,
      henrriCustomerFingerprint: organisations.henrriCustomerFingerprint,
      ...BILLING_ADDRESS_COLUMNS,
      requester: { id: users.id, email: users.email, firstName: users.firstname, lastName: users.lastname },
    })
    .from(quoteRequests)
    .innerJoin(organisations, eq(organisations.id, quoteRequests.organisationId))
    .innerJoin(users, eq(users.id, quoteRequests.requestedBy))
    .where(eq(quoteRequests.id, quoteRequestId))
    .limit(1)
  if (!row) return null
  const { request, requester } = row

  const [signer] = request.acceptedBy
    ? await db
        .select({ email: users.email, firstName: users.firstname, lastName: users.lastname })
        .from(users)
        .where(eq(users.id, request.acceptedBy))
    : []

  const items = await db
    .select()
    .from(quoteRequestItems)
    .where(eq(quoteRequestItems.quoteRequestId, quoteRequestId))
    .orderBy(asc(quoteRequestItems.position))

  const address = completeBillingAddress(row)
  return {
    quoteRequestId,
    number: request.number,
    validUntil: request.validUntil,
    organisationId: request.organisationId,
    henrriCustomerId: row.henrriCustomerId,
    henrriCustomerFingerprint: row.henrriCustomerFingerprint,
    company: address
      ? {
          companyName: row.legalName,
          siret: row.siret,
          contact: { firstName: requester.firstName ?? "", lastName: requester.lastName ?? "" },
          address,
        }
      : null,
    source:
      request.shippingPortions && request.totalTtc
        ? {
            lines: items.map((item) => ({
              productName: item.productName,
              productSku: item.productSku,
              variantLabel: item.variantLabel,
              qty: item.qty,
              quotedPriceHt: item.quotedPriceHt === null ? null : Number(item.quotedPriceHt),
              vatPct: Number(item.vatPct),
            })),
            shippingPortions: request.shippingPortions,
            totalTtc: Number(request.totalTtc),
          }
        : null,
    requester: { id: requester.id, email: requester.email },
    acceptance:
      signer && request.acceptedAt && request.acceptedIp
        ? {
            email: signer.email,
            firstName: signer.firstName ?? "",
            lastName: signer.lastName ?? "",
            at: request.acceptedAt,
            ip: request.acceptedIp,
          }
        : null,
  }
}

export async function saveOrganisationCustomer(organisationId: string, customerId: number, fingerprint: string) {
  await db
    .update(organisations)
    .set({ henrriCustomerId: customerId, henrriCustomerFingerprint: fingerprint })
    .where(eq(organisations.id, organisationId))
}
