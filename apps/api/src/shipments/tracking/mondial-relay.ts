import { createHash } from "node:crypto"
import { env } from "../../env.js"
import { interpretMondialRelayTracing, type MondialRelayEvent } from "./interpret.js"
import type { TrackingProvider, TrackingResult } from "./types.js"
import { UNKNOWN_TRACKING } from "./types.js"

const MONDIAL_RELAY_ENDPOINT = "https://api.mondialrelay.com/Web_Services.asmx"
const SOAP_ACTION = "http://www.mondialrelay.fr/webservice/WSI2_TracingColisDetaille"
const REQUEST_TIMEOUT_MS = 10_000

/** Mondial Relay's `STAT` code for a call that went through. */
const STAT_OK = "0"

const escapeXml = (value: string) =>
  value.replace(
    /[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] as string,
  )

/**
 * The `Security` field: an uppercase MD5 of the parameters concatenated in the
 * documented order, followed by the private key.
 *
 * MD5 is the service's own requirement, not a choice of ours — it is an
 * integrity token on a call carrying no secret, never a password hash.
 */
export function mondialRelaySecurity(enseigne: string, expedition: string, langue: string, privateKey: string): string {
  return createHash("md5").update(`${enseigne}${expedition}${langue}${privateKey}`).digest("hex").toUpperCase()
}

const tag = (xml: string, name: string): string | null =>
  new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(xml)?.[1]?.trim() ?? null

/**
 * Pull the tracing table out of the SOAP envelope.
 *
 * ⚠️ Read defensively on purpose. Mondial Relay publishes no open specification
 * of this response, so rather than pinning exact element names we walk each
 * tracing entry and take whichever of the documented spellings it carries. An
 * entry we cannot read is dropped, never guessed at — and an unreadable table
 * simply reads as "nothing new", which changes no parcel.
 */
export function parseMondialRelayTracing(xml: string): MondialRelayEvent[] {
  const entries = xml.match(/<ret_WSI2_sub_TracingColisDetaille[^>]*>[\s\S]*?<\/ret_WSI2_sub_TracingColisDetaille>/gi)
  if (!entries) return []
  return entries.flatMap((entry) => {
    const label = tag(entry, "Libelle")
    if (!label) return []
    return [{ label, date: tag(entry, "Date") ?? undefined, hour: tag(entry, "Heure") ?? undefined }]
  })
}

/**
 * Mondial Relay tracking, over their SOAP web service (`WSI2_TracingColisDetaille`).
 *
 * ⚠️ Unlike La Poste, this service returns FREE-TEXT French labels rather than
 * status codes — `interpretMondialRelayTracing` is where "delivered" is read,
 * and it errs towards "still travelling" on anything it does not recognise.
 */
export class MondialRelayTrackingProvider implements TrackingProvider {
  readonly carriers = ["mondial-relay"] as const

  constructor(
    private readonly enseigne: string,
    private readonly privateKey: string,
  ) {}

  async fetchStatus(trackingNumber: string): Promise<TrackingResult> {
    const expedition = trackingNumber.trim()
    const security = mondialRelaySecurity(this.enseigne, expedition, "FR", this.privateKey)
    const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <WSI2_TracingColisDetaille xmlns="http://www.mondialrelay.fr/webservice/">
      <Enseigne>${escapeXml(this.enseigne)}</Enseigne>
      <Expedition>${escapeXml(expedition)}</Expedition>
      <Langue>FR</Langue>
      <Security>${security}</Security>
    </WSI2_TracingColisDetaille>
  </soap:Body>
</soap:Envelope>`

    const response = await fetch(MONDIAL_RELAY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: SOAP_ACTION },
      body: envelope,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`Mondial Relay tracking failed (${response.status}) for ${expedition}`)

    const xml = await response.text()
    const stat = tag(xml, "STAT")
    // A non-zero STAT is the service saying it could not answer — an unknown
    // parcel number included. Nothing to record, and nothing worth retrying.
    if (stat !== STAT_OK) return UNKNOWN_TRACKING

    return interpretMondialRelayTracing(parseMondialRelayTracing(xml))
  }
}

/** The provider, or null when no credentials are configured. */
export function createMondialRelayProvider(): MondialRelayTrackingProvider | null {
  const { MONDIAL_RELAY_ENSEIGNE: enseigne, MONDIAL_RELAY_PRIVATE_KEY: key } = env
  return enseigne && key ? new MondialRelayTrackingProvider(enseigne, key) : null
}
