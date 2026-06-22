import type { Address, NewAddress } from "~/types/checkout"

// Authenticated address-book operations (reused by checkout and the future
// account area). All routes require a session — see useApi.
export function useAddresses() {
  const api = useApi()

  function list(): Promise<Address[]> {
    return api<{ data: Address[] }>("/addresses").then((r) => r.data)
  }

  function create(address: NewAddress): Promise<Address> {
    return api<{ data: Address }>("/addresses", { method: "POST", body: address }).then((r) => r.data)
  }

  return { list, create }
}
