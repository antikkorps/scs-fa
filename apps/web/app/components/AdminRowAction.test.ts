// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import AdminRowAction from "./AdminRowAction.vue"

describe("AdminRowAction (Franck, 2026-11-01)", () => {
  it("is an icon named for screen readers, with the same name as a tooltip", async () => {
    const wrapper = await mountSuspended(AdminRowAction, {
      props: { icon: "delete", label: "Supprimer", danger: true },
    })
    const button = wrapper.find("button.row-action")
    expect(button.attributes("aria-label")).toBe("Supprimer")
    expect(button.attributes("type")).toBe("button")
    expect(button.classes()).toContain("row-action--danger")
    expect(button.find("svg").attributes("aria-hidden")).toBe("true")
    expect(button.find("[role='tooltip']").text()).toBe("Supprimer")
  })

  it("is a link when it leads somewhere", async () => {
    const wrapper = await mountSuspended(AdminRowAction, {
      props: { icon: "edit", label: "Modifier", to: "/admin/x/1" },
    })
    const link = wrapper.find("a.row-action")
    expect(link.attributes("href")).toBe("/admin/x/1")
    expect(link.attributes("aria-label")).toBe("Modifier")
  })

  it("passes the click on", async () => {
    const wrapper = await mountSuspended(AdminRowAction, { props: { icon: "archive", label: "Archiver" } })
    await wrapper.find("button").trigger("click")
    expect(wrapper.emitted("click")).toHaveLength(1)
  })
})
