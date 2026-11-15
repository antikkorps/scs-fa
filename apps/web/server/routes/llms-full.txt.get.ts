import type { H3Event } from "h3"
import {
  buildLlmsFull,
  type LlmsArticle,
  type LlmsArtwork,
  type LlmsCategory,
  type LlmsFullInput,
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

/**
 * The whole catalogue, read from the API at most every ten minutes (SEO audit
 * 2026-11-15, finding 6): up to a hundred API calls per file otherwise.
 */
const cachedCatalogue = defineCachedFunction(
  async (event: H3Event): Promise<LlmsFullInput> => {
    const { base, headers } = apiUpstream(event)
    const get = <T>(path: string) => $fetch<T>(`${base}${path}`, { headers })
    const none = <T>() => [] as T[]
    const [artworks, articles, series, products, categories] = await Promise.all([
      get<{ data: LlmsArtwork[] }>("/artworks").then((r) => r.data, none<LlmsArtwork>),
      fetchAll<LlmsArticle>(`${base}/blog`, headers).catch(none<LlmsArticle>),
      get<{ data: LlmsSeries[] }>("/artworks/series").then((r) => r.data, none<LlmsSeries>),
      fetchAll<LlmsProduct>(`${base}/products`, headers).catch(none<LlmsProduct>),
      get<{ data: LlmsCategory[] }>("/product-categories").then((r) => r.data, none<LlmsCategory>),
    ])
    return { artworks, articles, series, products, categories }
  },
  { ...AGENT_FILE_CACHE, name: "llms-full-catalogue", getKey: () => "all" },
)

export default defineEventHandler(async (event) => {
  const siteUrl = useRuntimeConfig(event).public.siteUrl as string
  const comingSoon = await comingSoonAgentAnswer(event, siteUrl)
  if (comingSoon !== null) return comingSoon

  setHeader(event, "content-type", "text/plain; charset=utf-8")
  setHeader(event, "cache-control", "public, max-age=3600")
  return buildLlmsFull(siteUrl, await cachedCatalogue(event), await llmsStage(event))
})
