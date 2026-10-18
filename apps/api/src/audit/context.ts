import { AsyncLocalStorage } from "node:async_hooks"

/**
 * What an audit event learns from the request that produced it (story 12.7b),
 * without every service having to pass it down: the request id ties an order's
 * history to the technical logs of the same request.
 */
export interface RequestContext {
  reqId: string
}

const storage = new AsyncLocalStorage<RequestContext>()

/** Run `work` — and everything it awaits — inside the given request's context. */
export function runWithRequestContext<T>(context: RequestContext, work: () => T): T {
  return storage.run(context, work)
}

/** The current request's id, or null outside a request (scheduled jobs, CLIs). */
export function currentReqId(): string | null {
  return storage.getStore()?.reqId ?? null
}
