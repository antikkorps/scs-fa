import { type LegalIdentity, missingLegalFacts } from "@armurier/shared"

/**
 * Static reference pages written in the codebase — the privacy policy, the
 * regulation guide (story 9.6), the legal notice and the CGV (story 12.1) —
 * and whether the client (and, for the legal texts, a lawyer) has validated them.
 *
 * The flag drives both sides: an unvalidated page shows a draft notice and is
 * `noindex`, and it stays out of the sitemap. Flip `reviewed` here, and only
 * here, once Fred and Steph have read the text; a page stating the seller's
 * identity also waits for every fact to be entered in the back-office.
 */
export const EDITORIAL_PAGES = {
  confidentialite: { path: "/confidentialite", reviewed: false },
  reglementation: { path: "/reglementation", reviewed: false },
  mentionsLegales: { path: "/mentions-legales", reviewed: false },
  cgv: { path: "/cgv", reviewed: false },
} as const satisfies Record<string, { path: string; reviewed: boolean }>

export type EditorialPageKey = keyof typeof EDITORIAL_PAGES

/** Pages that state the seller's legal identity (the shop_identity record). */
export const IDENTITY_PAGES = ["confidentialite", "mentionsLegales", "cgv"] as const satisfies EditorialPageKey[]

/**
 * Whether a page may be indexed and listed: validated by the client and, for a
 * page that states the seller's identity, with every fact supplied — the
 * identity is entered in the back-office, so this is checked at run time.
 */
export function isEditorialPagePublishable(
  key: EditorialPageKey,
  identity: LegalIdentity,
  pages: typeof EDITORIAL_PAGES = EDITORIAL_PAGES,
): boolean {
  if (!pages[key].reviewed) return false
  const statesIdentity = (IDENTITY_PAGES as readonly EditorialPageKey[]).includes(key)
  return !statesIdentity || missingLegalFacts(identity).length === 0
}

/** Paths of the publishable pages — the ones a sitemap may list. */
export function publishableEditorialPaths(
  identity: LegalIdentity,
  pages: typeof EDITORIAL_PAGES = EDITORIAL_PAGES,
): string[] {
  return (Object.keys(pages) as EditorialPageKey[])
    .filter((key) => isEditorialPagePublishable(key, identity, pages))
    .map((key) => pages[key].path)
}
