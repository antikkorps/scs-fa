import { buildLlmsTxt } from "../utils/seo"

export default defineEventHandler(async (event) => {
  const siteUrl = useRuntimeConfig(event).public.siteUrl as string
  const comingSoon = await comingSoonAgentAnswer(event, siteUrl)
  if (comingSoon !== null) return comingSoon

  setHeader(event, "content-type", "text/plain; charset=utf-8")
  setHeader(event, "cache-control", "public, max-age=3600")
  return buildLlmsTxt(siteUrl, await llmsStage(event))
})
