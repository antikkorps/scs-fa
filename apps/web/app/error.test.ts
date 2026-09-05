// @vitest-environment nuxt

import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it, vi } from "vitest"
import { ref } from "vue"
import type { NuxtError } from "#app"
import ErrorPage from "./error.vue"

// error.vue wraps <NuxtLayout>, which renders AppHeader → mock its composables.
mockNuxtImport("useAuth", () => () => ({
  isAuthenticated: ref(false),
  isAdmin: ref(false),
  user: ref(null),
  logout: vi.fn(),
}))
mockNuxtImport("useCart", () => () => ({ count: ref(0) }))
mockNuxtImport("useProductCategories", () => () => ({ categories: ref([]) }))

const err = (statusCode: number) => ({ statusCode }) as unknown as NuxtError

describe("error page", () => {
  it("renders a neutral, two-universe 404", async () => {
    const wrapper = await mountSuspended(ErrorPage, { props: { error: err(404) } })
    const text = wrapper.text()
    expect(text).toContain("404")
    expect(text).toContain("Page introuvable")
    expect(text).toContain("armurerie") // both universes referenced, not Gun-Art-only
    const buttons = wrapper.findAll("button").map((b) => b.text())
    expect(buttons).toContain("La boutique")
    expect(buttons).toContain("La collection")
  })

  it("renders a generic message for a 500", async () => {
    const wrapper = await mountSuspended(ErrorPage, { props: { error: err(500) } })
    const text = wrapper.text()
    expect(text).toContain("500")
    expect(text).toContain("Une erreur est survenue")
  })
})
