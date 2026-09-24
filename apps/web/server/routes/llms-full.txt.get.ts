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
async function fetchAll<T>(url: string, headers: Record<string, string>): Promise<T[]> {
  const rows: T[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await $fetch<Page<T>>(url, { query: { page, limit: 100 }, headers })
    rows.push(...res.data)
    if (!res.pagination?.hasMore) break
  }
  return rows
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const { base, headers } = apiUpstream(event)
  const get = <T>(path: string) => $fetch<T>(`${base}${path}`, { headers })
  const siteUrl = config.public.siteUrl as string

  const none = <T>() => [] as T[]
  const [artworks, articles, series, products, categories] = await Promise.all([
    get<{ data: LlmsArtwork[] }>("/artworks").then((r) => r.data, none<LlmsArtwork>),
    fetchAll<LlmsArticle>(`${base}/blog`, headers).catch(none<LlmsArticle>),
    get<{ data: LlmsSeries[] }>("/artworks/series").then((r) => r.data, none<LlmsSeries>),
    fetchAll<LlmsProduct>(`${base}/products`, headers).catch(none<LlmsProduct>),
    get<{ data: LlmsCategory[] }>("/product-categories").then((r) => r.data, none<LlmsCategory>),
  ])

  setHeader(event, "content-type", "text/plain; charset=utf-8")
  setHeader(event, "cache-control", "public, max-age=3600")
  return buildLlmsFull(siteUrl, { artworks, articles, series, products, categories })
})
