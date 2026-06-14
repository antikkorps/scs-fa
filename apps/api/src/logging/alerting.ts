// Throttled error alerting. A burst of the same failure (a flapping dependency,
// a hot endpoint hitting the same bug) must not turn into an email storm, so we
// alert at most once per error *signature* within a cooldown window. Pure and
// injectable: the caller provides `sendAlert`, the clock and the cooldown, so it
// is fully unit-testable without timers, SMTP or a real Pino instance.

export interface AlertContext {
  /** Stable grouping key for the failure (e.g. "GET /api/orders Error"). */
  signature: string
  statusCode: number
  method: string
  url: string
  reqId: string
  message: string
  stack?: string
}

export interface AlerterDeps {
  sendAlert: (ctx: AlertContext) => Promise<void>
  /** Best-effort logger for delivery failures (alerting must never throw into a request). */
  onError?: (err: unknown) => void
  now?: () => number
  cooldownMs?: number
}

export interface Alerter {
  /** Returns true when an alert was dispatched, false when throttled. */
  alert: (ctx: AlertContext) => Promise<boolean>
}

const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000

export function createAlerter(deps: AlerterDeps): Alerter {
  const cooldownMs = deps.cooldownMs ?? DEFAULT_COOLDOWN_MS
  const now = deps.now ?? Date.now
  const lastAlertedAt = new Map<string, number>()

  // Drop entries older than the cooldown so the map can't grow unbounded under
  // a long-lived process seeing many distinct signatures.
  function prune(currentNow: number) {
    if (lastAlertedAt.size < 1000) return
    for (const [key, at] of lastAlertedAt) {
      if (currentNow - at >= cooldownMs) lastAlertedAt.delete(key)
    }
  }

  return {
    async alert(ctx) {
      const currentNow = now()
      const last = lastAlertedAt.get(ctx.signature)
      if (last !== undefined && currentNow - last < cooldownMs) return false

      lastAlertedAt.set(ctx.signature, currentNow)
      prune(currentNow)

      try {
        await deps.sendAlert(ctx)
      } catch (err) {
        deps.onError?.(err)
      }
      return true
    },
  }
}
