import { canonicalPath } from "../utils/canonicalPath"

// One URL per page (story 9.6): a trailing slash or capitals are moved for good
// to the canonical spelling, query string kept. See utils/canonicalPath.ts.
export default defineEventHandler((event) => {
  if (event.method !== "GET" && event.method !== "HEAD") return
  const [path = "/", query] = event.path.split("?", 2)
  const target = canonicalPath(path)
  if (target) return sendRedirect(event, query ? `${target}?${query}` : target, 301)
})
