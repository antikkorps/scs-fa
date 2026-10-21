// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import AdminDrawer from "./AdminDrawer.vue"

describe("AdminDrawer", () => {
  it("is a labelled modal dialog around its content", async () => {
    const wrapper = await mountSuspended(AdminDrawer, {
      props: { label: "Armurerie Armand" },
      slots: { default: () => "Fiche" },
    })
    const dialog = wrapper.find('[role="dialog"]')
    expect(dialog.attributes("aria-modal")).toBe("true")
    expect(dialog.attributes("aria-label")).toBe("Armurerie Armand")
    expect(dialog.text()).toContain("Fiche")
  })

  it("closes from its button, the backdrop and the Escape key", async () => {
    const wrapper = await mountSuspended(AdminDrawer, { props: { label: "Fiche" }, attachTo: document.body })
    await wrapper.find(".drawer__close").trigger("click")
    await wrapper.find(".drawer-scrim").trigger("click")
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    expect(wrapper.emitted("close")).toHaveLength(3)
    wrapper.unmount()
  })
})
