/**
 * Static reference pages written in the codebase — the privacy policy, the
 * regulation guide (story 9.6), the legal notice and the CGV (story 12.1) —
 * and whether the client (and, for the legal texts, a lawyer) has validated them.
 *
 * One flag drives both sides: an unvalidated page shows a draft notice and is
 * `noindex`, and it stays out of the sitemap. Flip `reviewed` here, and only
 * here, once Fred and Steph have read (and completed) the text.
 */
export const EDITORIAL_PAGES = {
  confidentialite: { path: "/confidentialite", reviewed: false },
  reglementation: { path: "/reglementation", reviewed: false },
  mentionsLegales: { path: "/mentions-legales", reviewed: false },
  cgv: { path: "/cgv", reviewed: false },
} as const satisfies Record<string, { path: string; reviewed: boolean }>

export type EditorialPageKey = keyof typeof EDITORIAL_PAGES

/** Pages that state the seller's legal identity (legalIdentity.ts). */
export const IDENTITY_PAGES = ["confidentialite", "mentionsLegales", "cgv"] as const satisfies EditorialPageKey[]

/** Paths of the validated pages — the ones a sitemap may list. */
export function reviewedEditorialPaths(): string[] {
  return Object.values(EDITORIAL_PAGES)
    .filter((p) => p.reviewed)
    .map((p) => p.path)
}
