import type { OrganisationRequestInput, ProSignupInput } from "@armurier/shared"
import type { MemberOrganisation, SiretLookup } from "~/types/organisation"

// Story 12.8b — the pro side of an account: signup, a request from an existing
// account, and the member's own organisation.
export function useOrganisation() {
  const api = useApi()

  async function lookup(siret: string): Promise<SiretLookup> {
    return (await api<{ data: SiretLookup }>("/organisations/lookup", { query: { siret } })).data
  }

  function signup(input: ProSignupInput) {
    return api("/organisations/signup", { method: "POST", body: input })
  }

  function request(input: OrganisationRequestInput) {
    return api<{ data: MemberOrganisation }>("/organisations/request", { method: "POST", body: input })
  }

  /** Null for an account outside any organisation. */
  async function mine(): Promise<MemberOrganisation | null> {
    try {
      return (await api<{ data: MemberOrganisation }>("/organisations/mine")).data
    } catch (err) {
      if (authErrorStatus(err) === 404) return null
      throw err
    }
  }

  return { lookup, signup, request, mine }
}
