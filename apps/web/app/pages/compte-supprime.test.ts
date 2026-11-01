// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import AccountDeleted from "./compte-supprime.vue"

describe("compte-supprime.vue (story 12.11)", () => {
  it("confirms the deletion and says what the law keeps", async () => {
    const wrapper = await mountSuspended(AccountDeleted)
    expect(wrapper.find("h1").text()).toBe("Votre compte a été supprimé")
    expect(wrapper.text()).toMatch(/e-mail de confirmation/)
    expect(wrapper.text()).toMatch(/10 ans/)
    expect(wrapper.find("a[href='/']").exists()).toBe(true)
  })
})
