// @vitest-environment nuxt
import { EMPTY_SHOP_IDENTITY } from "@armurier/shared"
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"
import Contact from "./contact.vue"

const { identity } = vi.hoisted(() => ({ identity: { value: {} as Record<string, string | null> } }))
mockNuxtImport("useFetch", () => () => ({ data: ref({ data: identity.value }), error: ref(null) }))

beforeEach(() => {
  // The identity is kept in request state: each case starts as a fresh request.
  clearNuxtState("shop-identity")
})

describe("contact.vue (audit 2026-11-01, I8)", () => {
  it("shows how to reach the shop, from the identity the admins entered", async () => {
    identity.value = {
      ...EMPTY_SHOP_IDENTITY,
      email: "contact@scs-firearms.fr",
      phone: "04 78 00 00 00",
      address: "3 quai du Stand, 69002 Lyon",
      contactHours: "Du mardi au samedi, 9 h – 18 h",
      contactNote: "Retrait en boutique sur rendez-vous.",
    }
    const wrapper = await mountSuspended(Contact, { route: "/contact" })
    expect(wrapper.find("h1").text()).toBe("Nous contacter")
    expect(wrapper.find("a[href='mailto:contact@scs-firearms.fr']").exists()).toBe(true)
    expect(wrapper.find("a[href='tel:+33478000000']").exists()).toBe(true)
    expect(wrapper.text()).toContain("3 quai du Stand, 69002 Lyon")
    expect(wrapper.text()).toContain("Du mardi au samedi, 9 h – 18 h")
    expect(wrapper.text()).toContain("Retrait en boutique sur rendez-vous.")
    // Then the form (I8b), whatever the identity holds.
    expect(wrapper.find("form textarea[name='message']").exists()).toBe(true)
  })

  it("says the details are coming rather than showing empty lines", async () => {
    identity.value = { ...EMPTY_SHOP_IDENTITY }
    const wrapper = await mountSuspended(Contact, { route: "/contact" })
    expect(wrapper.find("a[href^='mailto:']").exists()).toBe(false)
    expect(wrapper.text()).toMatch(/bientôt/)
  })
})
