// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import { ref } from "vue"
import { fetchWithShopMenu } from "../../tests/helpers/shopMenu"
import HeaderMobileNav from "./HeaderMobileNav.vue"

// The mobile overlay is teleported to <body>, so it is queried on the document.
mockNuxtImport("useFetch", () => fetchWithShopMenu)
mockNuxtImport("useAuth", () => () => ({ isAuthenticated: ref(false), isAdmin: ref(false) }))
mockNuxtImport("useCart", () => () => ({ count: ref(0) }))

const rowTexts = () =>
  [...document.querySelectorAll("#mobile-nav .mlink")].map((row) => row.textContent?.replace("›", "").trim())

describe("HeaderMobileNav", () => {
  it("renders nothing while closed", async () => {
    const wrapper = await mountSuspended(HeaderMobileNav, { props: { open: false } })
    expect(document.querySelector("#mobile-nav")).toBeNull()
    wrapper.unmount()
  })

  // Review of 12.15c (UI/UX): the signatures first, as two cards, then the
  // universes under their title, then the house.
  it("opens with the two signatures as cards, above the universes", async () => {
    const wrapper = await mountSuspended(HeaderMobileNav, { props: { open: true } })
    expect(document.querySelector("#mobile-nav")?.getAttribute("aria-label")).toBe("Navigation mobile")
    const cards = [...document.querySelectorAll("#mobile-nav a.msig")].map((card) => card.getAttribute("href"))
    expect(cards).toEqual(["/armes-de-collection", "/gun-art"])
    const signatures = document.querySelector("#mobile-nav .msigs")
    const universes = document.querySelector("#mobile-nav .mnav--universes")
    expect(signatures && universes && signatures.compareDocumentPosition(universes)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    wrapper.unmount()
  })

  it("lists the house after the universes", async () => {
    const wrapper = await mountSuspended(HeaderMobileNav, { props: { open: true } })
    const rows = rowTexts()
    expect(rows.slice(-2)).toEqual(["Journal", "À propos"])
    expect(rows.indexOf("Journal")).toBeGreaterThan(rows.indexOf("Coutellerie"))
    wrapper.unmount()
  })

  it("asks to be closed from its close button", async () => {
    const wrapper = await mountSuspended(HeaderMobileNav, { props: { open: true } })
    ;(document.querySelector(".mobile__close") as HTMLElement | null)?.click()
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false])
    wrapper.unmount()
  })
})
