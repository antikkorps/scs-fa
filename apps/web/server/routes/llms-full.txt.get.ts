import {
  buildLlmsFull,
  type LlmsArticle,
  type LlmsArtwork,
  type LlmsCategory,
  type LlmsProduct,
  type LlmsSeries,
} from "../utils/seo"

// Safety net against a runaway loop: 50 pages of 100 is far beyond the catalogue.
const MAX_PAGES = 50

interface Page<T> {
  data: T[]
  pagination?: { hasMore: boolean }
}

/** Every row of a paginated public listing — the agent file must not stop at page one. */
async function fetchAll<T>(url: string): Promise<T[]> {
  const rows: T[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await $fetch<Page<T>>(url, { query: { page, limit: 100 } })
    rows.push(...res.data)
    if (!res.pagination?.hasMore) break
  }
  return rows
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const apiBase = config.public.apiBase as string
  const siteUrl = config.public.siteUrl as string

  const none = <T>() => [] as T[]
  const [artworks, articles, series, products, categories] = await Promise.all([
    $fetch<{ data: LlmsArtwork[] }>(`${apiBase}/artworks`).then((r) => r.data, none<LlmsArtwork>),
    fetchAll<LlmsArticle>(`${apiBase}/blog`).catch(none<LlmsArticle>),
    $fetch<{ data: LlmsSeries[] }>(`${apiBase}/artworks/series`).then((r) => r.data, none<LlmsSeries>),
    fetchAll<LlmsProduct>(`${apiBase}/products`).catch(none<LlmsProduct>),
    $fetch<{ data: LlmsCategory[] }>(`${apiBase}/product-categories`).then((r) => r.data, none<LlmsCategory>),
  ])

  setHeader(event, "content-type", "text/plain; charset=utf-8")
  setHeader(event, "cache-control", "public, max-age=3600")
  return buildLlmsFull(siteUrl, { artworks, articles, series, products, categories })
})
