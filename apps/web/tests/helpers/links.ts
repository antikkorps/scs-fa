/** The page a login / sign-up link leads to, and the way back it carries. */
export function returnOf(href: string | undefined) {
  const url = new URL(href ?? "", "https://scs.test")
  return { path: url.pathname, redirect: url.searchParams.get("redirect"), motif: url.searchParams.get("motif") }
}
