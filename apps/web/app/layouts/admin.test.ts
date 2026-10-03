// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it, vi } from "vitest"
import { reactive } from "vue"
import AdminLayout from "./admin.vue"

// The admin pages sit behind the `admin` middleware, which bounces a test
// navigation to the login screen: the route is stubbed instead.
const { current } = vi.hoisted(() => ({ current: { path: "/admin", fullPath: "/admin" } }))
mockNuxtImport("useRoute", () => () => reactive(current))

mockNuxtImport("useAuth", () => () => ({ user: { value: { firstName: "Fred", lastName: "Admin" } }, logout: () => {} }))

async function mountAt(path: string) {
  Object.assign(current, { path, fullPath: path })
  return mountSuspended(AdminLayout)
}

describe("admin layout sidebar", () => {
  it("files every screen under a titled group, the dashboard alone on top", async () => {
    const wrapper = await mountAt("/admin")
    expect(wrapper.findAll(".nav__heading").map((h) => h.text())).toEqual([
      "Ventes",
      "Catalogue",
      "Gun Art",
      "Finance",
      "Contenu",
    ])
    const links = wrapper.findAll(".nav__link").map((a) => a.attributes("href"))
    expect(links[0]).toBe("/admin")
    expect(links).toHaveLength(18)
    // No screen lost or listed twice in the regrouping.
    expect(new Set(links).size).toBe(links.length)
    expect(links).toEqual(expect.arrayContaining(["/admin/livraison", "/admin/metrics", "/admin/blog"]))
  })

  it("highlights the current screen only — the dashboard matches exactly", async () => {
    const wrapper = await mountAt("/admin/gun-art/series")
    const active = wrapper.findAll(".nav__link--active").map((a) => a.attributes("href"))
    expect(active).toEqual(["/admin/gun-art/series"])
  })
})
