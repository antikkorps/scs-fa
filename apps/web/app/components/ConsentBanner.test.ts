// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { beforeEach, describe, expect, it } from "vitest"
import ConsentBanner from "./ConsentBanner.vue"

describe("ConsentBanner (story 9.6)", () => {
  beforeEach(() => {
    // biome-ignore lint/suspicious/noDocumentCookie: resetting the test browser's cookie jar
    document.cookie = "scs_consent=; max-age=0; path=/"
    useState("consent-reopened").value = false
    useState("consent-value").value = null
    useCookie("scs_consent").value = null
  })

  it("asks a visitor who has not chosen yet, with refusing as prominent as accepting", async () => {
    const wrapper = await mountSuspended(ConsentBanner)
    const buttons = wrapper.findAll("button")
    expect(buttons.map((b) => b.text())).toEqual(["Refuser", "Accepter"])
    // Same classes, same weight: no dark pattern.
    expect(buttons[0]?.classes()).toEqual(buttons[1]?.classes())
    expect(wrapper.find('a[href="/confidentialite"]').exists()).toBe(true)
  })

  it.each([
    ["Accepter", "granted"],
    ["Refuser", "denied"],
  ])("remembers « %s » and steps aside", async (label, choice) => {
    const wrapper = await mountSuspended(ConsentBanner)
    const button = wrapper.findAll("button").find((b) => b.text() === label)
    await button?.trigger("click")
    expect(useConsent().choice.value).toBe(choice)
    expect(wrapper.find("section").exists()).toBe(false)
  })

  it("shares one state across every caller — the analytics plugin sees the banner's answer", async () => {
    const plugin = useConsent()
    const wrapper = await mountSuspended(ConsentBanner)
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Accepter")
      ?.trigger("click")
    expect(plugin.analyticsAllowed.value).toBe(true)
  })

  it("comes back when the visitor reopens it from the footer", async () => {
    const consent = useConsent()
    consent.refuse()
    const wrapper = await mountSuspended(ConsentBanner)
    expect(wrapper.find("section").exists()).toBe(false)
    consent.reopen()
    await nextTick()
    expect(wrapper.find("section").exists()).toBe(true)
  })
})
