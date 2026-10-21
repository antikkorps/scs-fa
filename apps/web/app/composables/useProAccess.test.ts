// @vitest-environment nuxt
import { mockNuxtImport } from "@nuxt/test-utils/runtime"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useProAccess } from "./useProAccess"

const { mine, user } = vi.hoisted(() => ({ mine: vi.fn(), user: { value: null as null | { id: string } } }))
mockNuxtImport("useOrganisation", () => () => ({ mine }))
mockNuxtImport("useAuth", () => () => ({ user, isAuthenticated: { value: user.value !== null } }))

beforeEach(() => {
  mine.mockReset()
  user.value = null
  useState("pro-access").value = undefined
})

describe("useProAccess (story 12.8c)", () => {
  it("is off for a visitor, without asking the API", async () => {
    const access = useProAccess()
    await access.load()
    expect(access.isApprovedPro.value).toBe(false)
    expect(mine).not.toHaveBeenCalled()
  })

  it("is on for the member of an approved organisation, asked once per account", async () => {
    user.value = { id: "u1" }
    mine.mockResolvedValue({ id: "o1", status: "approved" })
    const access = useProAccess()
    await access.load()
    await access.load()
    expect(access.isApprovedPro.value).toBe(true)
    expect(mine).toHaveBeenCalledOnce()
  })

  it("is off while the organisation waits for approval, and asks again for another account", async () => {
    user.value = { id: "u1" }
    mine.mockResolvedValueOnce({ id: "o1", status: "pending" })
    const access = useProAccess()
    await access.load()
    expect(access.isApprovedPro.value).toBe(false)
    expect(access.organisation.value?.status).toBe("pending")

    user.value = { id: "u2" }
    mine.mockResolvedValueOnce(null)
    await access.load()
    expect(mine).toHaveBeenCalledTimes(2)
    expect(access.organisation.value).toBeNull()
  })
})
