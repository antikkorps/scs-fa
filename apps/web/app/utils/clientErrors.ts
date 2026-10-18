// Story 12.7d — errors seen in the browser on the cart, checkout and payment
// pages, reported to the API so they reach the technical logs. Only the error
// itself is sent: never a form value. The limits mirror the API's schema.

export type ClientErrorKind = "error" | "unhandledrejection" | "vue" | "network" | "stripe"

export interface ClientErrorReport {
  kind: ClientErrorKind
  message: string
  path: string
  stack?: string
  code?: string
}

const TRACKED_PATH = /^\/(panier|commande)(\/|$)/
const MAX_MESSAGE = 500
const MAX_STACK = 4000
const MAX_CODE = 100

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return (text || "Unknown error").slice(0, MAX_MESSAGE)
}

export function createClientErrorReporter(options: { path: () => string; send: (report: ClientErrorReport) => void }) {
  // One report per error and page: a loop that throws must not flood the API.
  const sent = new Set<string>()

  return function report(kind: ClientErrorKind, error: unknown, extra: { code?: string } = {}): void {
    const path = options.path().replace(/[?#].*$/, "")
    if (!TRACKED_PATH.test(path)) return
    const message = messageOf(error)
    const key = `${kind}|${path}|${message}`
    if (sent.has(key)) return
    sent.add(key)

    const stack = error instanceof Error ? error.stack?.slice(0, MAX_STACK) : undefined
    options.send({
      kind,
      message,
      path,
      ...(stack ? { stack } : {}),
      ...(extra.code ? { code: extra.code.slice(0, MAX_CODE) } : {}),
    })
  }
}

/** A call that never got an answer (network down, API unreachable) — not an API refusal. */
export function isNetworkFailure(error: unknown): boolean {
  const failure = error as { name?: string; response?: unknown } | null
  return failure?.name === "FetchError" && !failure.response
}

/** Stripe errors the customer can fix themselves are not bugs: a declined card, an incomplete field. */
export function isReportableStripeError(error: { type?: string }): boolean {
  return error.type !== "card_error" && error.type !== "validation_error"
}

type Reporter = ReturnType<typeof createClientErrorReporter>

// Set by the client plugin, never on the server: until then, reports go nowhere.
let current: Reporter | null = null

export function setClientErrorReporter(reporter: Reporter | null): void {
  current = reporter
}

/** Report from anywhere — a composable after an `await` has no Nuxt context left. */
export function reportClientError(...args: Parameters<Reporter>): void {
  current?.(...args)
}

/** Same origin, through the BFF; `keepalive` lets it leave even as the page unloads. */
export function sendClientErrorReport(report: ClientErrorReport): void {
  fetch("/bff/api/client-errors", {
    method: "POST",
    keepalive: true,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(report),
  }).catch(() => {
    // Nowhere left to report to: the page carries on.
  })
}
