import { originMatchesHost } from "../utils/csrf"

// CSRF defence-in-depth for the BFF: reject state-changing requests whose
// browser Origin doesn't match the site host. Covers /bff/auth/* and the
// /bff/api/* proxy (both rely on the httpOnly session cookies). Complements the
// SameSite=lax cookies.
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"])

export default defineEventHandler((event) => {
  if (!MUTATING.has(event.method)) return
  if (!event.path.startsWith("/bff/")) return

  const origin = getRequestHeader(event, "origin")
  const host = getRequestHeader(event, "host")
  if (!originMatchesHost(origin, host)) {
    throw createError({ statusCode: 403, statusMessage: "Cross-origin request rejected" })
  }
})
