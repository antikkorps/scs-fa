import { buildLlmsFull, type LlmsArticle, type LlmsArtwork, type LlmsSeries } from "../utils/seo"

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const apiBase = config.public.apiBase as string
  const siteUrl = config.public.siteUrl as string

  const [artworks, blog, series] = await Promise.all([
    $fetch<{ data: LlmsArtwork[] }>(`${apiBase}/artworks`).catch(() => ({ data: [] as LlmsArtwork[] })),
    $fetch<{ data: LlmsArticle[] }>(`${apiBase}/blog`, { query: { limit: 100 } }).catch(() => ({
      data: [] as LlmsArticle[],
    })),
    $fetch<{ data: LlmsSeries[] }>(`${apiBase}/artworks/series`).catch(() => ({ data: [] as LlmsSeries[] })),
  ])

  setHeader(event, "content-type", "text/plain; charset=utf-8")
  setHeader(event, "cache-control", "public, max-age=3600")
  return buildLlmsFull(siteUrl, artworks.data, blog.data, series.data)
})
