// @vitest-environment nuxt
import { mockNuxtImport } from "@nuxt/test-utils/runtime"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useProfile } from "./useProfile"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))

mockNuxtImport("useApi", () => () => apiMock)

beforeEach(() => {
  apiMock.mockReset()
})

describe("useProfile", () => {
  it("fetches the profile from /auth/me without an envelope", async () => {
    apiMock.mockResolvedValue({ id: "u1", email: "a@b.fr", firstName: "Ada" })
    const profile = useProfile()
    const res = await profile.get()
    expect(apiMock).toHaveBeenCalledWith("/auth/me")
    expect(res.firstName).toBe("Ada")
  })

  it("updates the profile via PATCH /auth/me", async () => {
    apiMock.mockResolvedValue({ id: "u1", firstName: "Grace" })
    const profile = useProfile()
    const res = await profile.update({ firstName: "Grace", phone: null })
    expect(apiMock).toHaveBeenCalledWith("/auth/me", { method: "PATCH", body: { firstName: "Grace", phone: null } })
    expect(res.firstName).toBe("Grace")
  })
})
