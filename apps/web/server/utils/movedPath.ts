// Sections that changed address; each old prefix moves for good to its new one.
const MOVED_PREFIXES: [from: string, to: string][] = [
  // Story 12.15c-bis: « Collection » also named the armes de collection.
  ["/collection", "/gun-art"],
]

/** Where a page moved to (story 12.15c-bis), or null when it did not. */
export function movedPath(path: string): string | null {
  for (const [from, to] of MOVED_PREFIXES) {
    if (path === from || path.startsWith(`${from}/`)) return to + path.slice(from.length)
  }
  return null
}
