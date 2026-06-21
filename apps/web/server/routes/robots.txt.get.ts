import { buildRobots } from "../utils/seo"

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  const siteUrl = config.public.siteUrl as string
  setHeader(event, "content-type", "text/plain; charset=utf-8")
  setHeader(event, "cache-control", "public, max-age=86400")
  return buildRobots(siteUrl)
})
