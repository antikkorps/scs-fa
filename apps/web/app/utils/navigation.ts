/**
 * Sanitise a post-login `?redirect=` target so it can only point back into this
 * site. Rejects absolute URLs (`https://evil.com`), scheme-relative (`//evil`),
 * and the backslash trick (`/\evil`) that some browsers normalise to `//evil` —
 * any of which would turn our login flow into an open redirect. Returns the
 * fallback for anything that isn't a single-slash absolute path.
 */
export function safeInternalPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string") return fallback
  if (!/^\/(?![/\\])/.test(value)) return fallback
  return value
}
