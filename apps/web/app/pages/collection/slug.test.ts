// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"
import ArtworkPage from "./[slug].vue"

const { artwork, addPrintMock, navigateToMock, auth, launch } = vi.hoisted(() => ({
  artwork: {
    id: "a1",
    slug: "eclat-de-bronze",
    title: "Éclat de Bronze",
    description: null,
    longDescription: null,
    artist: null,
    series: null,
    featuredImageUrl: null,
    orientation: "landscape",
    editionLimit: 25,
    editionYear: 2025,
    availableFormats: [{ id: "a2", name: "A2" }],
    vatPct: 20,
    includeCertificate: true,
    prints: [
      {
        id: "p3",
        printNumber: 3,
        printDesignation: "3/25",
        formatId: "a2",
        status: "available",
        priceHt: 375,
        priceTtc: 450,
      },
      {
        id: "p7",
        printNumber: 7,
        printDesignation: "7/25",
        formatId: "a2",
        status: "available",
        priceHt: 375,
        priceTtc: 450,
      },
      {
        id: "p1",
        printNumber: 1,
        printDesignation: "1/25",
        formatId: "a2",
        status: "sold",
        priceHt: 375,
        priceTtc: 450,
      },
    ],
    availableCount: 2,
    soldCount: 1,
    priceFromHt: 375,
    priceFromTtc: 450,
  },
  addPrintMock: vi.fn(),
  navigateToMock: vi.fn(),
  auth: { authenticated: true },
  launch: { open: true },
}))

mockNuxtImport("useFetch", () => () => ({ data: ref({ data: artwork }), error: ref(null), refresh: vi.fn() }))
mockNuxtImport("useCart", () => () => ({ addPrint: addPrintMock }))
mockNuxtImport("useAuth", () => () => ({ isAuthenticated: ref(auth.authenticated) }))
mockNuxtImport("useLaunch", () => () => ({ salesOpen: ref(launch.open), recheckAdmin: vi.fn() }))
mockNuxtImport("navigateTo", () => navigateToMock)

const mounted = async () => {
  const wrapper = await mountSuspended(ArtworkPage, { route: "/collection/eclat-de-bronze" })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  addPrintMock.mockReset().mockResolvedValue({ summary: { itemCount: 1 } })
  navigateToMock.mockReset()
  auth.authenticated = true
  launch.open = true
})

describe("collection/[slug].vue — buying a print (UX audit 2026-11-01)", () => {
  it("offers each available print as a choice, and adds the chosen one to the cart", async () => {
    const wrapper = await mounted()
    const choices = wrapper.findAll("input[name='print']")
    expect(choices.map((input) => input.attributes("value"))).toEqual(["p3", "p7"])

    await wrapper.find("input[value='p7']").setValue(true)
    await wrapper.find("button.prints__cta").trigger("click")
    await flushPromises()

    expect(addPrintMock).toHaveBeenCalledWith("p7")
    expect(wrapper.find("[role='status']").text()).toContain("ajouté à votre panier")
    expect(wrapper.find("[role='status'] a").attributes("href")).toBe("/panier")
  })

  it("picks the first available print when the visitor chooses none", async () => {
    const wrapper = await mounted()
    await wrapper.find("button.prints__cta").trigger("click")
    await flushPromises()
    expect(addPrintMock).toHaveBeenCalledWith("p3")
  })

  it("sends a visitor without an account to the login, and back to this print", async () => {
    auth.authenticated = false
    const wrapper = await mounted()
    await wrapper.find("button.prints__cta").trigger("click")
    await flushPromises()
    expect(addPrintMock).not.toHaveBeenCalled()
    expect(navigateToMock).toHaveBeenCalledWith("/connexion?redirect=%2Fcollection%2Feclat-de-bronze")
  })

  it("says so when someone else took that print in the meantime", async () => {
    addPrintMock.mockRejectedValue(
      Object.assign(new Error("Conflict"), {
        response: { status: 409, _data: { error: "Conflict" } },
        data: { error: "Conflict", message: "Print is not available" },
      }),
    )
    const wrapper = await mounted()
    await wrapper.find("button.prints__cta").trigger("click")
    await flushPromises()
    expect(wrapper.find("[role='alert']").text()).toMatch(/vient d'être réservé/)
  })

  it("sells nothing before the opening", async () => {
    launch.open = false
    const wrapper = await mounted()
    expect(wrapper.find("button.prints__cta").exists()).toBe(false)
    expect(wrapper.text()).toMatch(/ouverture/i)
  })
})
