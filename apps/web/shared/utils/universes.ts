// Story 12.13 — the two universes asked for by Fred, each with a page of its
// own and a top-level menu entry. Hunting is a use across categories (a rifle
// stays a long gun): it gathers the products tagged « chasse ». Knives are a
// product type: the « coutellerie » category. Read by the pages, the link
// helpers (so every link leads to the universe page), the sitemap and llms.txt.

export interface Universe {
  path: string
  name: string
  /** What the universe gathers: one tag across categories, or one category. */
  source: { kind: "tag"; slug: string } | { kind: "category"; slug: string }
}

export const UNIVERSES: readonly Universe[] = [
  { path: "/chasse", name: "Chasse", source: { kind: "tag", slug: "chasse" } },
  { path: "/coutellerie", name: "Coutellerie", source: { kind: "category", slug: "coutellerie" } },
]

function universePathFor(kind: Universe["source"]["kind"], slug: string): string | null {
  return UNIVERSES.find((u) => u.source.kind === kind && u.source.slug === slug)?.path ?? null
}

/** The universe page standing for a category, or null for an ordinary category. */
export function universePathForCategory(slug: string): string | null {
  return universePathFor("category", slug)
}

/** The universe page standing for a tag, or null for an ordinary tag. */
export function universePathForTag(slug: string): string | null {
  return universePathFor("tag", slug)
}
