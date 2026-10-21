// Story 12.8b — the State's company registry (recherche-entreprises.api.gouv.fr:
// free, no key). Asked once when a pro signs up, so SCS sees whether the SIRET
// is a real, open establishment before approving it by hand.
//
// The registry is a convenience, not a gate (decision 2026-10-21): when it is
// down or does not know the number, the request is still taken, flagged as
// unverified for SCS.
import { z } from "zod"

const REGISTRY_URL = "https://recherche-entreprises.api.gouv.fr/search"
const DEFAULT_TIMEOUT_MS = 5_000

export interface RegistryEstablishment {
  siret: string
  legalName: string
  legalNature: string | null
  activityCode: string | null
  address: string | null
  active: boolean
}

export type RegistryLookup =
  | { status: "found"; establishment: RegistryEstablishment }
  | { status: "not_found" }
  | { status: "unavailable" }

const ACTIVE = "A"

const answerSchema = z.object({
  results: z.array(
    z.object({
      nom_complet: z.string(),
      nom_raison_sociale: z.string().nullable().optional(),
      nature_juridique: z.string().nullable().optional(),
      matching_etablissements: z
        .array(
          z.object({
            siret: z.string(),
            etat_administratif: z.string(),
            adresse: z.string().nullable().optional(),
            activite_principale: z.string().nullable().optional(),
          }),
        )
        .default([]),
    }),
  ),
})

export interface RegistryOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

async function fetchAnswer(siret: string, options: RegistryOptions): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch
  const signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  // The race bounds the wait even if the fetch implementation ignores the signal.
  const timedOut = new Promise<never>((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true })
  })
  const response = await Promise.race([
    fetchImpl(`${REGISTRY_URL}?q=${siret}&page=1&per_page=1`, { signal, headers: { accept: "application/json" } }),
    timedOut,
  ])
  if (!response.ok) throw new Error(`Registry answered HTTP ${response.status}`)
  return await Promise.race([response.json(), timedOut])
}

/** What the registry knows of one establishment. Never throws: a failure is `unavailable`. */
export async function lookUpEstablishment(siret: string, options: RegistryOptions = {}): Promise<RegistryLookup> {
  let answer: z.infer<typeof answerSchema>
  try {
    answer = answerSchema.parse(await fetchAnswer(siret, options))
  } catch {
    return { status: "unavailable" }
  }

  for (const company of answer.results) {
    const establishment = company.matching_etablissements.find((candidate) => candidate.siret === siret)
    if (!establishment) continue
    return {
      status: "found",
      establishment: {
        siret,
        legalName: company.nom_raison_sociale ?? company.nom_complet,
        legalNature: company.nature_juridique ?? null,
        activityCode: establishment.activite_principale ?? null,
        address: establishment.adresse ?? null,
        active: establishment.etat_administratif === ACTIVE,
      },
    }
  }
  return { status: "not_found" }
}
