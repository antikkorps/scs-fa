// @vitest-environment nuxt
import type { OrganisationStatus } from "@armurier/shared"
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import ProAccessNotice from "./ProAccessNotice.vue"

const mountFor = (status: OrganisationStatus | null) =>
  mountSuspended(ProAccessNotice, {
    props: { organisation: status ? { status, legalName: "Club du Val", reviewReason: "Impayés" } : null },
  })

describe("ProAccessNotice (story 12.8c)", () => {
  it("invites a customer outside any organisation to ask for a pro account", async () => {
    const wrapper = await mountFor(null)
    expect(wrapper.text()).toContain("réservé aux comptes professionnels")
    expect(wrapper.find('a[href="/compte#compte-pro"]').exists()).toBe(true)
  })

  it("tells a pending pro the space opens once SCS approves", async () => {
    expect((await mountFor("pending")).text()).toContain("dès que votre compte sera validé")
  })

  it("tells a suspended pro why", async () => {
    const text = (await mountFor("suspended")).text()
    expect(text).toContain("suspendu")
    expect(text).toContain("Impayés")
  })

  it("points a refused pro to a new request", async () => {
    const wrapper = await mountFor("rejected")
    expect(wrapper.text()).toContain("refusée")
    expect(wrapper.find('a[href="/compte#compte-pro"]').exists()).toBe(true)
  })
})
