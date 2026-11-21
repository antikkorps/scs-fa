import { canonicalPath } from "../utils/canonicalPath"
import { movedPath } from "../utils/movedPath"

// One URL per page (story 9.6): a trailing slash or capitals are moved for good
// to the canonical spelling, and a section that changed address to its new one
// (story 12.15c-bis), in a single hop, query string kept. See
// utils/canonicalPath.ts and utils/movedPath.ts.
export default defineEventHandler((event) => {
  if (event.method !== "GET" && event.method !== "HEAD") return
  const [path = "/", query] = event.path.split("?", 2)
  const spelled = canonicalPath(path) ?? path
  const target = movedPath(spelled) ?? spelled
  if (target !== path) return sendRedirect(event, query ? `${target}?${query}` : target, 301)
})
