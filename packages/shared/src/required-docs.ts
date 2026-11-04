// I7 — decision Franck 2026-11-04: what a legal category asks of the customer.
// Each entry is a document type, or a group of alternatives of which one
// approved document is enough — category C asks an identity document and
// either a hunting licence validated for the season or a sport-shooting
// licence: ["cni", ["permis_chasse", "licence_tir"]]. Stored as such in
// legal_categories.required_doc_types (jsonb).
import { LEGAL_DOC_LABELS, LEGAL_DOC_TYPES, type LegalDocType } from "./constants.js"

export type RequiredDocEntry = LegalDocType | LegalDocType[]

const isLegalDocType = (value: unknown): value is LegalDocType =>
  typeof value === "string" && (LEGAL_DOC_TYPES as readonly string[]).includes(value)

/** The entries of a stored value; anything unknown is dropped, a group of one becomes that type. */
export function parseRequiredDocEntries(value: unknown): RequiredDocEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): RequiredDocEntry[] => {
    if (isLegalDocType(entry)) return [entry]
    if (!Array.isArray(entry)) return []
    const alternatives = [...new Set(entry.filter(isLegalDocType))]
    if (alternatives.length === 0) return []
    return alternatives.length === 1 ? [alternatives[0] as LegalDocType] : [alternatives]
  })
}

/** The document types that satisfy an entry. */
export function docTypesOf(entry: RequiredDocEntry): LegalDocType[] {
  return Array.isArray(entry) ? entry : [entry]
}

/** A stable key for an entry (lists, deduplication). */
export function requiredDocEntryKey(entry: RequiredDocEntry): string {
  return docTypesOf(entry).join("|")
}

/** An entry as the customer reads it: « Permis de chasser validé ou licence de tir sportif ». */
export function requiredDocEntryLabel(entry: RequiredDocEntry): string {
  const [first, ...others] = docTypesOf(entry).map((type) => LEGAL_DOC_LABELS[type])
  if (others.length === 0) return first ?? ""
  return [first, ...others.map((label) => label.charAt(0).toLowerCase() + label.slice(1))].join(" ou ")
}

// Renewed every season: the end of their validity is required on upload, so
// the daily expiry turns an approved one « expired » once the season is over.
const SEASONAL_DOC_TYPES: ReadonlySet<string> = new Set<LegalDocType>(["permis_chasse", "licence_tir"])

export function requiresValidityEnd(docType: string): boolean {
  return SEASONAL_DOC_TYPES.has(docType)
}
