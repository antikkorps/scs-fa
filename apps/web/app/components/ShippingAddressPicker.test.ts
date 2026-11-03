// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it, vi } from "vitest"
import ShippingAddressPicker from "./ShippingAddressPicker.vue"

mockNuxtImport("useAddresses", () => () => ({ create: vi.fn() }))

const mountForm = () => mountSuspended(ShippingAddressPicker, { props: { addresses: [], modelValue: "" } })

// UX audit 2026-11-01 (I5): a placeholder vanishes as soon as one types, and is
// no label for a screen reader. Every field carries a visible label.
describe("ShippingAddressPicker — new address form", () => {
  it("labels every field, and says which ones are optional", async () => {
    const wrapper = await mountForm()
    const labels = wrapper.findAll(".addr-form label").map((label) => ({
      text: label.text(),
      hasInput: label.find("input").exists(),
    }))
    expect(labels).toEqual([
      { text: "Prénom", hasInput: true },
      { text: "Nom", hasInput: true },
      { text: "Adresse", hasInput: true },
      { text: "Complément d'adresse (facultatif)", hasInput: true },
      { text: "Code postal", hasInput: true },
      { text: "Ville", hasInput: true },
      { text: "Téléphone (facultatif)", hasInput: true },
    ])
  })

  it("marks the required fields as such for the browser and assistive technologies", async () => {
    const wrapper = await mountForm()
    const required = wrapper.findAll(".addr-form input[required]").map((input) => input.attributes("autocomplete"))
    expect(required).toEqual(["given-name", "family-name", "address-line1", "postal-code", "address-level2"])
  })
})
