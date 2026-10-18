/**
 * A fixed-window rate limiter kept in memory (story 12.7d), for a public route
 * that needs a budget of its own — tighter than the app-wide one, and active
 * under test too. One API process, so memory is the right place.
 */
export function createWindowLimiter(options: { max: number; windowMs: number; now?: () => number }) {
  const now = options.now ?? Date.now
  const windows = new Map<string, { startedAt: number; hits: number }>()

  /** Drop the windows that are over: a visitor who left costs nothing. */
  function sweep(at: number) {
    for (const [key, window] of windows) {
      if (at - window.startedAt >= options.windowMs) windows.delete(key)
    }
  }

  return {
    /** Count a hit for `key`; false once it is over budget for the current window. */
    hit(key: string): boolean {
      const at = now()
      sweep(at)
      const window = windows.get(key)
      if (!window) {
        windows.set(key, { startedAt: at, hits: 1 })
        return true
      }
      window.hits += 1
      return window.hits <= options.max
    },
    size: () => windows.size,
  }
}
