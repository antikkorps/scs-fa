// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import AdminTabs from "./AdminTabs.vue"

const TABS = [
  { id: "detail", label: "Détail" },
  { id: "history", label: "Historique" },
]

const mounted = (modelValue = "detail") =>
  mountSuspended(AdminTabs, { props: { tabs: TABS, modelValue, label: "Fiche commande" } })

describe("AdminTabs (story 12.7b)", () => {
  it("renders an accessible tab list, the current tab selected and focusable", async () => {
    const wrapper = await mounted()

    expect(wrapper.find("[role='tablist']").attributes("aria-label")).toBe("Fiche commande")
    const tabs = wrapper.findAll("[role='tab']")
    expect(tabs.map((tab) => tab.text())).toEqual(["Détail", "Historique"])
    expect(tabs[0]?.attributes()).toMatchObject({
      "aria-selected": "true",
      tabindex: "0",
      "aria-controls": "panel-detail",
    })
    expect(tabs[1]?.attributes()).toMatchObject({ "aria-selected": "false", tabindex: "-1", id: "tab-history" })
  })

  it("switches on a click", async () => {
    const wrapper = await mounted()
    await wrapper.findAll("[role='tab']")[1]?.trigger("click")
    expect(wrapper.emitted("update:modelValue")).toEqual([["history"]])
  })

  it("moves with the arrow keys, wrapping around", async () => {
    const wrapper = await mounted("history")
    const current = wrapper.findAll("[role='tab']")[1]
    await current?.trigger("keydown", { key: "ArrowRight" })
    await current?.trigger("keydown", { key: "ArrowLeft" })
    expect(wrapper.emitted("update:modelValue")).toEqual([["detail"], ["detail"]])
  })
})
