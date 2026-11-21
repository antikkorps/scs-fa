// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import { SIGNATURES } from "~/utils/signatures"
import SignaturePanel from "./SignaturePanel.vue"

const signature = (key: string) => {
  const found = SIGNATURES.find((candidate) => candidate.key === key)
  if (!found) throw new Error(`No signature ${key}`)
  return found
}

describe("SignaturePanel", () => {
  it("pitches Gun Art, then leads to the artist before the gallery", async () => {
    const wrapper = await mountSuspended(SignaturePanel, { props: { signature: signature("gunart") } })
    expect(wrapper.find(".mega__label").text()).toBe("Gun Art")
    expect(wrapper.text()).toContain("Signées & numérotées")
    const targets = wrapper.findAll("a.mega__cta").map((cta) => cta.attributes("href"))
    expect(targets).toEqual(["/collection/artiste", "/collection"])
  })

  it("pitches the collection with its pieces for sale and those already sold", async () => {
    const wrapper = await mountSuspended(SignaturePanel, { props: { signature: signature("collection") } })
    const targets = wrapper.findAll("a.mega__cta").map((cta) => cta.attributes("href"))
    expect(targets).toEqual(["/armes-de-collection", "/armes-de-collection?vendues=1"])
  })
})
