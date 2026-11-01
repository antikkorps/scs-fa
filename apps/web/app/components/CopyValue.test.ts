// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { afterEach, describe, expect, it, vi } from "vitest"
import CopyValue from "./CopyValue.vue"

const writeText = vi.fn()

afterEach(() => {
  writeText.mockReset()
  vi.unstubAllGlobals()
})

const mounted = (props: { value: string; display?: string; label: string }) => mountSuspended(CopyValue, { props })

describe("CopyValue (audit 2026-11-01, I1)", () => {
  it("shows the value as read, copies it as typed", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: writeText.mockResolvedValue(undefined) } })
    const wrapper = await mounted({
      value: "FR7630006000011234567890189",
      display: "FR76 3000 6000 0112 3456 7890 189",
      label: "l'IBAN",
    })
    expect(wrapper.find(".copy__value").text()).toBe("FR76 3000 6000 0112 3456 7890 189")
    expect(wrapper.find("button").attributes("aria-label")).toBe("Copier l'IBAN")

    await wrapper.find("button").trigger("click")
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith("FR7630006000011234567890189")
    expect(wrapper.find("[role=status]").text()).toBe("Copié")
  })

  it("says so when the browser refuses the clipboard, the value staying selectable", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: writeText.mockRejectedValue(new Error("denied")) } })
    const wrapper = await mounted({ value: "SCS-AB12-CD34", label: "la référence" })

    await wrapper.find("button").trigger("click")
    await flushPromises()

    expect(wrapper.find("[role=status]").text()).toContain("Copie impossible")
  })
})
