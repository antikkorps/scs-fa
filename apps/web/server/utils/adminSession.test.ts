import { describe, expect, it, vi } from "vitest"
import { isAdminSession } from "./adminSession"

const answer = (status: number, role?: string) => ({ status, role })

describe("isAdminSession (story 12.10)", () => {
  it("asks nothing of a visitor without a session", async () => {
    const whoAmI = vi.fn()
    expect(await isAdminSession({ accessToken: undefined, hasRefreshToken: false, whoAmI, refresh: vi.fn() })).toBe(
      false,
    )
    expect(whoAmI).not.toHaveBeenCalled()
  })

  it("trusts the API's answer, not the browser's", async () => {
    const admin = vi.fn().mockResolvedValue(answer(200, "admin"))
    const customer = vi.fn().mockResolvedValue(answer(200, "customer"))
    const base = { accessToken: "t", hasRefreshToken: true, refresh: vi.fn() }
    expect(await isAdminSession({ ...base, whoAmI: admin })).toBe(true)
    expect(await isAdminSession({ ...base, whoAmI: customer })).toBe(false)
    expect(admin).toHaveBeenCalledWith("t")
  })

  it("rotates an expired session once and asks again", async () => {
    const whoAmI = vi.fn().mockResolvedValueOnce(answer(401)).mockResolvedValueOnce(answer(200, "admin"))
    const refresh = vi.fn().mockResolvedValue("fresh")
    expect(await isAdminSession({ accessToken: "old", hasRefreshToken: true, whoAmI, refresh })).toBe(true)
    expect(whoAmI).toHaveBeenLastCalledWith("fresh")
  })

  it("gives up when the session cannot be rotated", async () => {
    const whoAmI = vi.fn().mockResolvedValue(answer(401))
    expect(
      await isAdminSession({
        accessToken: "old",
        hasRefreshToken: true,
        whoAmI,
        refresh: vi.fn().mockResolvedValue(null),
      }),
    ).toBe(false)
    expect(whoAmI).toHaveBeenCalledOnce()
  })

  it("is not an administrator when the API cannot be reached", async () => {
    const whoAmI = vi.fn().mockRejectedValue(new Error("down"))
    expect(await isAdminSession({ accessToken: "t", hasRefreshToken: false, whoAmI, refresh: vi.fn() })).toBe(false)
  })
})
