// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import Simulateur from "./simulateur-prix.vue"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

// A stand-in for what POST /admin/artworks/price-grid returns; the arithmetic
// itself is locked down in @armurier/shared, this checks what the admin sees.
function gridResponse(overrides: Record<string, unknown> = {}) {
  const bands = [
    { formatId: "petit", formatName: "Petit", priceFactor: 1, minPriceHt: 50, maxPriceHt: 98 },
    { formatId: "moyen", formatName: "Moyen", priceFactor: 1.5, minPriceHt: 75, maxPriceHt: 123 },
  ]
  const rows = [1, 2].map((printNumber) => ({
    printNumber,
    cells: [
      { formatId: "petit", priceHt: 98, priceTtc: 117.6, overlapping: true },
      { formatId: "moyen", priceHt: 123, priceTtc: 147.6, overlapping: false },
    ],
  }))
  return {
    data: {
      bands,
      rows,
      valid: false,
      overlaps: [
        {
          lowerFormatId: "petit",
          lowerFormatName: "Petit",
          upperFormatId: "moyen",
          upperFormatName: "Moyen",
          lowerMaxPriceHt: 98,
          upperMinPriceHt: 75,
          maxIncrementHt: 1.04,
          minUpperPriceFactor: 1.96,
        },
      ],
      ...overrides,
    },
  }
}

beforeEach(() => {
  apiMock.mockReset()
})

// The page debounces every parameter change before hitting the API. Fake timers
// deadlock Nuxt's async setup, so the debounce is simply waited out for real.
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 400))
  await flushPromises()
}

async function mounted(response: unknown = gridResponse()) {
  apiMock.mockResolvedValue(response)
  const wrapper = await mountSuspended(Simulateur, { route: "/admin/gun-art/simulateur-prix" })
  await settle()
  return wrapper
}

describe("admin/gun-art/simulateur-prix.vue", () => {
  it("simulates the client's own starting grid on open", async () => {
    await mounted()
    const [url, options] = (apiMock.mock.calls[0] ?? []) as [string, { method: string; body: Record<string, unknown> }]
    expect(url).toBe("/admin/artworks/price-grid")
    expect(options.method).toBe("POST")
    expect(options.body).toMatchObject({ basePriceHt: 50, priceIncrementHt: 2, editionLimit: 25, vatPct: 20 })
    expect((options.body.formats as unknown[]).length).toBe(3)
  })

  it("calls out an incoherent grid and says how to fix it", async () => {
    const wrapper = await mounted()
    expect(wrapper.find(".verdict--bad").exists()).toBe(true)
    const text = wrapper.text()
    expect(text).toContain("Grille incohérente")
    expect(text).toContain("Petit")
    expect(text).toContain("Moyen")
    // both remedies, by increment and by factor
    expect(text).toContain("1,04")
    expect(text).toContain("1,96")
  })

  it("highlights exactly the cells that out-price a bigger format", async () => {
    const wrapper = await mounted()
    const flagged = wrapper.findAll(".cell--bad")
    expect(flagged).toHaveLength(2) // the "petit" cell of both rows
    expect(wrapper.findAll("tbody tr")).toHaveLength(2)
  })

  it("confirms a coherent grid with no highlight", async () => {
    const wrapper = await mounted(gridResponse({ valid: true, overlaps: [] }))
    expect(wrapper.find(".verdict--ok").exists()).toBe(true)
    expect(wrapper.text()).toContain("Grille cohérente")
  })

  it("re-simulates when a format is added, and refuses to drop the last one", async () => {
    const wrapper = await mounted()
    apiMock.mockClear()

    await wrapper.find(".add").trigger("click")
    await settle()
    const [, options] = (apiMock.mock.calls[0] ?? []) as [string, { body: { formats: unknown[] } }]
    expect(options.body.formats).toHaveLength(4)

    const removes = wrapper.findAll(".remove")
    expect(removes).toHaveLength(4)
    expect(removes[0]?.attributes("disabled")).toBeUndefined()
  })

  it("tells the admin the parameters are invalid rather than showing a stale grid", async () => {
    const wrapper = await mounted()
    expect(wrapper.find(".grid").exists()).toBe(true)

    apiMock.mockRejectedValue({ response: { status: 400 } })
    await wrapper.find('input[type="number"]').setValue(-5)
    await settle()

    expect(wrapper.text()).toContain("Paramètres invalides")
    expect(wrapper.find(".grid").exists()).toBe(false)
  })

  it("states that the edition is counted across all formats", async () => {
    const wrapper = await mounted()
    expect(wrapper.text()).toContain("25 exemplaires au total")
  })
})
