import type { Profile, UpdateProfile } from "~/types/account"

// Authenticated profile operations (API 1.3). The /auth/me endpoints return the
// user object directly — no `{ data }` envelope, unlike most other routes.
export function useProfile() {
  const api = useApi()

  function get(): Promise<Profile> {
    return api<Profile>("/auth/me")
  }

  function update(input: UpdateProfile): Promise<Profile> {
    return api<Profile>("/auth/me", { method: "PATCH", body: input })
  }

  return { get, update }
}
