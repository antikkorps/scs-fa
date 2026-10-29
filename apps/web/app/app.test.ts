// @vitest-environment nuxt

import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it, vi } from "vitest"
import { defineComponent, h, ref } from "vue"
import type { LaunchState } from "~/composables/useLaunch"
import App from "./app.vue"

// The open site renders <NuxtLayout>, whose header needs these.
mockNuxtImport("useAuth", () => () => ({
  isAuthenticated: ref(false),
  isAdmin: ref(false),
  user: ref(null),
  logout: vi.fn(),
}))
mockNuxtImport("useCart", () => () => ({ count: ref(0) }))
mockNuxtImport("useProductCategories", () => () => ({ categories: ref([]) }))

const NuxtPage = defineComponent({ name: "NuxtPage", render: () => h("p", { class: "page" }, "page") })

async function mountWith(state: LaunchState) {
  useState("launch").value = state
  return mountSuspended(App, { global: { stubs: { NuxtPage } } })
}

describe("app shell (story 12.10)", () => {
  it("answers every public page with the waiting page before the opening", async () => {
    const wrapper = await mountWith({ launchStage: "coming_soon", indexingEnabled: false, adminPreview: false })
    expect(wrapper.find("h1").text()).toBe("Ouverture prochaine")
    expect(wrapper.find(".page").exists()).toBe(false)
  })

  it("shows the page to an administrator, with the banner saying why", async () => {
    const wrapper = await mountWith({ launchStage: "coming_soon", indexingEnabled: false, adminPreview: true })
    expect(wrapper.find(".page").exists()).toBe(true)
    expect(wrapper.text()).toContain("visible car vous êtes administrateur")
  })

  it("shows the page in the showcase stage", async () => {
    const wrapper = await mountWith({ launchStage: "showcase", indexingEnabled: false, adminPreview: false })
    expect(wrapper.find(".page").exists()).toBe(true)
    expect(wrapper.text()).toContain("Les ventes ouvrent prochainement")
  })
})
