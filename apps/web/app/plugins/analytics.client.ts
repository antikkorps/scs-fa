/**
 * Audience measurement with Umami — only with consent (story 9.6).
 *
 * The tracker is served from our own origin (`/_a/`, proxied by Caddy to the
 * self-hosted Umami), so no third party sees the visit and the CSP needs no new
 * source. It is injected once consent is given, never before; a later refusal
 * sets Umami's own kill switch (`umami.disabled`), which the tracker checks
 * before every event, so measurement stops without a reload.
 *
 * Inert when no website id is configured (dev, preview).
 *
 * Every event goes through `withoutLinkTokensInEvent` first (story 12.9g): the
 * tracker calls the global function named by `data-before-send`, and a mailed
 * link's token (the unsubscribe one, in the query) is never recorded.
 */
import { withoutLinkTokensInEvent } from "~/utils/linkToken"

const DISABLE_KEY = "umami.disabled"
const BEFORE_SEND = "scsUmamiBeforeSend"

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const websiteId = config.public.umamiWebsiteId as string
  if (!websiteId) return

  const siteUrl = config.public.siteUrl as string
  const { analyticsAllowed } = useConsent()
  let injected = false

  function setDisabled(disabled: boolean) {
    try {
      if (disabled) localStorage.setItem(DISABLE_KEY, "1")
      else localStorage.removeItem(DISABLE_KEY)
    } catch {
      // Storage blocked: the tracker is simply never injected in that case.
    }
  }

  watch(
    analyticsAllowed,
    (allowed) => {
      setDisabled(!allowed)
      if (!allowed || injected) return
      Object.assign(window, {
        [BEFORE_SEND]: (_type: string, event: Record<string, unknown>) => withoutLinkTokensInEvent(event),
      })
      const script = document.createElement("script")
      script.defer = true
      script.src = "/_a/script.js"
      script.dataset.websiteId = websiteId
      script.dataset.hostUrl = `${siteUrl}/_a`
      script.dataset.beforeSend = BEFORE_SEND
      // Count the production domain only — never a preview or a local copy.
      script.dataset.domains = new URL(siteUrl).hostname
      document.head.appendChild(script)
      injected = true
    },
    { immediate: true },
  )
})
