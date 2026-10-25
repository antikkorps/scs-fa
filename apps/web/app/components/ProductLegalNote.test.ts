// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime"
import { describe, expect, it } from "vitest"
import ProductLegalNote from "./ProductLegalNote.vue"

describe("ProductLegalNote", () => {
  it("tells a customer their documents are checked after the order", async () => {
    const note = await mountSuspended(ProductLegalNote, { props: { pro: false } })
    expect(note.text()).toContain("vérification de vos documents après la commande")
    expect(note.find("a[href='/reglementation']").exists()).toBe(true)
  })

  // Story 12.8d — a pro buys by quote: SCS judges the organisation's documents first.
  it("tells a pro their organisation's documents are judged before the quote is accepted", async () => {
    const note = await mountSuspended(ProductLegalNote, { props: { pro: true } })
    expect(note.text()).toContain("justificatifs de votre organisation")
    expect(note.text()).not.toContain("après la commande")
    expect(note.find("a[href='/pro/documents']").exists()).toBe(true)
  })
})
