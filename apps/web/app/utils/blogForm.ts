import type { AdminBlogArticle, BlogFormValues } from "~/types/admin"

/** Empty editable form for a new article. */
export function emptyBlogForm(): BlogFormValues {
  return {
    slug: "",
    title: "",
    excerpt: "",
    content: "",
    category: "",
    tags: "",
    featuredImageUrl: "",
    metaTitle: "",
    metaDescription: "",
    published: false,
    featured: false,
  }
}

/** Hydrate the form from a fetched article (null fields become empty strings). */
export function blogFormFrom(a: AdminBlogArticle): BlogFormValues {
  return {
    slug: a.slug,
    title: a.title,
    excerpt: a.excerpt ?? "",
    content: a.content,
    category: a.category ?? "",
    tags: a.tags ?? "",
    featuredImageUrl: a.featuredImageUrl ?? "",
    metaTitle: a.metaTitle ?? "",
    metaDescription: a.metaDescription ?? "",
    published: a.published,
    featured: a.featured,
  }
}

/** Build the API body: trim, and send empty optional strings as null. */
export function toBlogPayload(v: BlogFormValues) {
  const nz = (s: string) => (s.trim() ? s.trim() : null)
  return {
    slug: v.slug.trim(),
    title: v.title.trim(),
    content: v.content,
    excerpt: nz(v.excerpt),
    category: nz(v.category),
    tags: nz(v.tags),
    featuredImageUrl: nz(v.featuredImageUrl),
    metaTitle: nz(v.metaTitle),
    metaDescription: nz(v.metaDescription),
    published: v.published,
    featured: v.featured,
  }
}

/** Friendly message from a $fetch error (validation issues or a plain message). */
export function blogErrorMessage(err: unknown, fallback = "Une erreur est survenue."): string {
  const data = (err as { data?: { message?: string; issues?: { message: string }[] } })?.data
  return data?.message ?? data?.issues?.[0]?.message ?? fallback
}
