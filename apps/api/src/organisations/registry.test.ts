import { describe, expect, it } from "vitest"
import { lookUpEstablishment } from "./registry.js"

const SIRET = "13002526500013"

// Trimmed from a real answer of recherche-entreprises.api.gouv.fr (2026-10-21).
function registryAnswer(establishment: Record<string, unknown> = {}) {
  return {
    results: [
      {
        siren: "130025265",
        nom_complet: "DIRECTION INTERMINISTERIELLE DU NUMERIQUE (DINUM)",
        nom_raison_sociale: "DIRECTION INTERMINISTERIELLE DU NUMERIQUE",
        nature_juridique: "7120",
        etat_administratif: "A",
        matching_etablissements: [
          {
            siret: SIRET,
            etat_administratif: "A",
            adresse: "20 AVENUE DE SEGUR 75007 PARIS",
            activite_principale: "84.11Z",
            ...establishment,
          },
        ],
      },
    ],
    total_results: 1,
  }
}

function fakeFetch(respond: () => Response | Promise<Response>) {
  const urls: string[] = []
  const fetchImpl: typeof fetch = async (input) => {
    urls.push(String(input))
    return respond()
  }
  return { fetchImpl, urls }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("lookUpEstablishment", () => {
  it("asks the registry for the SIRET and keeps what SCS needs to judge", async () => {
    const { fetchImpl, urls } = fakeFetch(() => json(registryAnswer()))

    const result = await lookUpEstablishment(SIRET, { fetchImpl })

    expect(urls[0]).toBe(`https://recherche-entreprises.api.gouv.fr/search?q=${SIRET}&page=1&per_page=1`)
    expect(result).toEqual({
      status: "found",
      establishment: {
        siret: SIRET,
        legalName: "DIRECTION INTERMINISTERIELLE DU NUMERIQUE",
        legalNature: "7120",
        activityCode: "84.11Z",
        address: "20 AVENUE DE SEGUR 75007 PARIS",
        active: true,
      },
    })
  })

  it("reports a closed establishment as inactive", async () => {
    const { fetchImpl } = fakeFetch(() => json(registryAnswer({ etat_administratif: "F" })))

    const result = await lookUpEstablishment(SIRET, { fetchImpl })

    expect(result.status === "found" && result.establishment.active).toBe(false)
  })

  it("says not found when no establishment carries that exact SIRET", async () => {
    // A search by number may match the company through another establishment.
    const { fetchImpl } = fakeFetch(() => json(registryAnswer({ siret: "13002526500021" })))
    expect(await lookUpEstablishment(SIRET, { fetchImpl })).toEqual({ status: "not_found" })

    const empty = fakeFetch(() => json({ results: [], total_results: 0 }))
    expect(await lookUpEstablishment(SIRET, { fetchImpl: empty.fetchImpl })).toEqual({ status: "not_found" })
  })

  it("says unavailable on an error status, a malformed answer, a network failure or a timeout", async () => {
    const cases: Array<() => Response | Promise<Response>> = [
      () => json({ erreur: "Too many requests" }, 429),
      () => json({ unexpected: true }),
      () => new Response("<html>maintenance</html>", { status: 200 }),
      () => Promise.reject(new TypeError("fetch failed")),
      () => new Promise<Response>(() => {}),
    ]
    for (const respond of cases) {
      const { fetchImpl } = fakeFetch(respond)
      expect(await lookUpEstablishment(SIRET, { fetchImpl, timeoutMs: 20 })).toEqual({ status: "unavailable" })
    }
  })
})
