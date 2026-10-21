// @vitest-environment nuxt
import { mockNuxtImport } from "@nuxt/test-utils/runtime"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useOrganisation } from "./useOrganisation"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))

mockNuxtImport("useApi", () => () => apiMock)

const REQUEST = { siret: "73282932000074", legalName: "Armurerie Dupont", organisationType: "armurier" as const }

beforeEach(() => {
  apiMock.mockReset()
})

describe("useOrganisation (story 12.8b)", () => {
  it("looks a SIRET up and unwraps the answer", async () => {
    apiMock.mockResolvedValue({ data: { status: "unavailable" } })
    expect(await useOrganisation().lookup("73282932000074")).toEqual({ status: "unavailable" })
    expect(apiMock).toHaveBeenCalledWith("/organisations/lookup", { query: { siret: "73282932000074" } })
  })

  it("files a pro signup and a request from an account", async () => {
    apiMock.mockResolvedValue({ data: { id: "o1" } })
    const organisation = useOrganisation()

    const signup = {
      ...REQUEST,
      email: "a@b.fr",
      password: "x".repeat(12),
      firstName: "A",
      lastName: "B",
      rgpdConsent: true as const,
    }
    await organisation.signup(signup)
    expect(apiMock).toHaveBeenCalledWith("/organisations/signup", { method: "POST", body: signup })

    await organisation.request(REQUEST)
    expect(apiMock).toHaveBeenCalledWith("/organisations/request", { method: "POST", body: REQUEST })
  })

  it("reads the member's organisation, or null outside any", async () => {
    apiMock.mockResolvedValueOnce({ data: { id: "o1", status: "pending" } })
    expect(await useOrganisation().mine()).toEqual({ id: "o1", status: "pending" })

    apiMock.mockRejectedValueOnce({ response: { status: 404 } })
    expect(await useOrganisation().mine()).toBeNull()

    apiMock.mockRejectedValueOnce({ response: { status: 500 } })
    await expect(useOrganisation().mine()).rejects.toBeTruthy()
  })
})
