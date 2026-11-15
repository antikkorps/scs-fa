import { EMPTY_SHOP_IDENTITY, type ShopIdentity, salesAreOpen } from "@armurier/shared"
import type { H3Event } from "h3"
import { publishableEditorialPaths } from "#shared/utils/editorialPages"
import { buildComingSoonAgentText, type LlmsStage } from "./llmsStage"
import { apiUpstream } from "./upstream"

// SEO audit 2026-11-15, findings 6 and 7 — the files agents read (llms.txt,
// llms-full.txt, the RSS feed) follow the launch stage like the pages do, and
// their costly API reads are cached server-side: Cloudflare does not cache
// .txt/.xml by default, and LLM crawlers are relentless.

/** Ten minutes, served stale while refreshing: catalogue changes show within that. */
export const AGENT_FILE_CACHE = { maxAge: 600, swr: true } as const

/**
 * Before the opening, an agent file answers like a page: 503, "opening soon",
 * and nothing of the catalogue. Returns the body to send, or null past it.
 * Checked on every request (the status is cached ~10 s), never cached itself:
 * switching the stage takes effect at once.
 */
export async function comingSoonAgentAnswer(event: H3Event, siteUrl: string): Promise<string | null> {
  if ((await shopStatus()).launchStage !== "coming_soon") return null
  setResponseStatus(event, 503)
  setHeader(event, "retry-after", 3600)
  setHeader(event, "content-type", "text/plain; charset=utf-8")
  setHeader(event, "cache-control", "no-store")
  return buildComingSoonAgentText(siteUrl)
}

/** The legal pages that may be published, cached: they change when the identity or a review flag does. */
const cachedLegalPaths = defineCachedFunction(
  async (event: H3Event): Promise<string[]> => {
    const { base, headers } = apiUpstream(event)
    const identity = await $fetch<{ data: ShopIdentity }>(`${base}/shop-identity`, { headers })
      .then((r) => r.data)
      .catch(() => EMPTY_SHOP_IDENTITY)
    return publishableEditorialPaths(identity)
  },
  { ...AGENT_FILE_CACHE, name: "agent-legal-paths", getKey: () => "all" },
)

/** What the agent files say about how far the shop is open, once past the waiting page. */
export async function llmsStage(event: H3Event): Promise<LlmsStage> {
  const { launchStage } = await shopStatus()
  return { salesOpen: salesAreOpen(launchStage), legalPaths: await cachedLegalPaths(event) }
}
