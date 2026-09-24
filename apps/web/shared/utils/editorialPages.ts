/**
 * Static reference pages written in the codebase (story 9.6) — the privacy
 * policy, the regulation guides — and whether the client has validated them.
 *
 * One flag drives both sides: an unvalidated page shows a draft notice and is
 * `noindex`, and it stays out of the sitemap. Flip `reviewed` here, and only
 * here, once Fred and Steph have read (and completed) the text.
 */
export const EDITORIAL_PAGES = {
  confidentialite: { path: "/confidentialite", reviewed: false },
} as const satisfies Record<string, { path: string; reviewed: boolean }>

export type EditorialPageKey = keyof typeof EDITORIAL_PAGES

/** Paths of the validated pages — the ones a sitemap may list. */
export function reviewedEditorialPaths(): string[] {
  return Object.values(EDITORIAL_PAGES)
    .filter((p) => p.reviewed)
    .map((p) => p.path)
}
