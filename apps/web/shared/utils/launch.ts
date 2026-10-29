import type { LaunchStage } from "@armurier/shared"

// Story 12.10 — before the opening, every public page answers with the waiting
// page. These stay reachable: the back-office (and its login), the two legal
// pages the waiting page links to, and the newsletter's confirm/unsubscribe links.
const EXACT_PATHS = new Set(["/admin", "/mentions-legales", "/confidentialite"])
const PATH_PREFIXES = ["/admin/", "/newsletter/"]

// Requests that never render a page: the BFF, the API, Nuxt's own assets and
// error endpoint. Anything with a file extension (sitemap.xml, favicon.ico) is
// a file, not a page.
const NON_PAGE_PREFIXES = ["/bff/", "/api/", "/_nuxt/", "/__nuxt"]
const FILE_EXTENSION = /\.[a-z0-9]+$/i

function passesThrough(path: string): boolean {
  return EXACT_PATHS.has(path) || PATH_PREFIXES.some((prefix) => path.startsWith(prefix))
}

export interface WaitingPageContext {
  stage: LaunchStage
  /** A signed-in administrator, checked server-side: browses the whole site. */
  adminPreview: boolean
  path: string
}

/** Whether `path` must answer with the waiting page instead of its own content. */
export function showsWaitingPage({ stage, adminPreview, path }: WaitingPageContext): boolean {
  if (stage !== "coming_soon" || adminPreview) return false
  return !passesThrough(path)
}

/** Whether a request renders a page (as opposed to the BFF, the API, an asset or a file). */
export function isPageRequest(method: string, url: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false
  const [path = "/"] = url.split("?", 1)
  if (NON_PAGE_PREFIXES.some((prefix) => path.startsWith(prefix))) return false
  return !FILE_EXTENSION.test(path)
}
