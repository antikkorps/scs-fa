// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import { nextTick, ref } from "vue"
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

  it("lists the shop tabs, then the collection, Gun Art, the journal and the house", async () => {
    const wrapper = await mountSuspended(HeaderMobileNav, { props: { open: true } })
    expect(document.querySelector("#mobile-nav")?.getAttribute("aria-label")).toBe("Navigation mobile")
    const rows = rowTexts()
    expect(rows.indexOf("Armes de collection")).toBeGreaterThan(rows.indexOf("Coutellerie"))
    expect(rows.slice(rows.indexOf("Armes de collection"))).toEqual([
      "Armes de collection",
      "Gun Art",
      "Journal",
      "À propos",
    ])
    expect(document.querySelector('a.mlink--feature[href="/armes-de-collection"]')).not.toBeNull()
    wrapper.unmount()
  })

  it("expands the Gun Art accordion", async () => {
    const wrapper = await mountSuspended(HeaderMobileNav, { props: { open: true } })
    const toggle = document.querySelector('button[aria-controls="msub-gunart"]') as HTMLElement | null
    toggle?.click()
    await nextTick()
    expect(toggle?.getAttribute("aria-expanded")).toBe("true")
    expect(document.querySelector('#msub-gunart a[href="/collection/artiste"]')).not.toBeNull()
    wrapper.unmount()
  })

  it("asks to be closed from its close button", async () => {
    const wrapper = await mountSuspended(HeaderMobileNav, { props: { open: true } })
    ;(document.querySelector(".mobile__close") as HTMLElement | null)?.click()
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false])
    wrapper.unmount()
  })
})
