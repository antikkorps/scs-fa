// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { clearNuxtData } from "#imports"
import type { AdminNewsletterContact, AdminNewsletterSummary, Pagination } from "~/types/admin"
import Newsletter from "./newsletter.vue"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

const SUMMARY: AdminNewsletterSummary = {
  segments: {
    armurerie: { pending: 2, confirmed: 41, unsubscribed: 3 },
    collection: { pending: 0, confirmed: 17, unsubscribed: 1 },
    gun_art: { pending: 1, confirmed: 9, unsubscribed: 0 },
  },
  contacts: 58,
  awaitingSync: 0,
}

const JEANNE: AdminNewsletterContact = {
  id: "c1",
  email: "jeanne@example.fr",
  createdAt: "2026-10-20T08:00:00Z",
  subscriptions: [
    {
      segment: "collection",
      status: "confirmed",
      requestedAt: "2026-10-20T08:00:00Z",
      confirmedAt: "2026-10-20T09:00:00Z",
      unsubscribedAt: null,
      consentSource: "/armes-de-collection",
      consentIp: "203.0.113.7",
      synced: false,
    },
    {
      segment: "gun_art",
      status: "unsubscribed",
      requestedAt: "2026-10-20T08:00:00Z",
      confirmedAt: null,
      unsubscribedAt: "2026-10-22T09:00:00Z",
      consentSource: null,
      consentIp: null,
      synced: false,
    },
  ],
}

const PAGE: Pagination = { page: 1, limit: 20, total: 1, totalPages: 1, hasMore: false }

function respond(summary: AdminNewsletterSummary, contacts: AdminNewsletterContact[], pagination = PAGE) {
  apiMock.mockImplementation(async (url: string) =>
    url.startsWith("/admin/newsletter/summary") ? { data: summary } : { data: contacts, pagination },
  )
}

async function mountPage() {
  const wrapper = await mountSuspended(Newsletter, { route: "/admin/newsletter" })
  await flushPromises()
  return wrapper
}

const plainText = (text: string) => text.replace(/\s+/g, " ")

beforeEach(() => {
  clearNuxtData()
  apiMock.mockReset()
  respond(SUMMARY, [JEANNE])
})

describe("admin/newsletter.vue — who is subscribed to what", () => {
  it("shows the confirmed subscribers of each segment, and those still to confirm", async () => {
    const wrapper = await mountPage()
    const cards = wrapper.findAll(".segment").map((card) => plainText(card.text()))
    expect(cards[0]).toContain("Armurerie")
    expect(cards[0]).toContain("41")
    expect(cards[0]).toContain("2 à confirmer")
    expect(cards[1]).toContain("Armes de collection")
    expect(cards[2]).toContain("Gun Art")
    expect(plainText(wrapper.text())).toContain("58 adresses")
    expect(wrapper.find(".sync-warning").exists()).toBe(false)
  })

  it("warns when confirmations have not reached Brevo yet", async () => {
    respond({ ...SUMMARY, awaitingSync: 2 }, [JEANNE])
    const wrapper = await mountPage()
    expect(plainText(wrapper.find(".sync-warning").text())).toContain("2 abonnements confirmés ne sont pas")
  })

  it("agrees the counts with a single subscriber", async () => {
    respond({ ...SUMMARY, contacts: 1, awaitingSync: 1 }, [JEANNE])
    const wrapper = await mountPage()
    expect(plainText(wrapper.find(".sync-warning").text())).toContain("1 abonnement confirmé n'est pas")
    expect(plainText(wrapper.text())).toContain("1 adresse enregistrée")
    expect(plainText(wrapper.findAll(".segment")[1]?.text() ?? "")).toMatch(/1 désabonné(?!s)/)
  })

  it("lists each contact with every subscription and its consent proof", async () => {
    const wrapper = await mountPage()
    expect(apiMock).toHaveBeenCalledWith("/admin/newsletter?page=1&limit=20")
    const row = plainText(wrapper.find("tbody tr").text())
    expect(row).toContain("jeanne@example.fr")
    expect(row).toContain("Armes de collection")
    expect(row).toContain("Abonné")
    expect(row).toContain("/armes-de-collection")
    expect(row).toContain("203.0.113.7")
    expect(row).toContain("Gun Art")
    expect(row).toContain("Désabonné")
  })

  it("flags a confirmed subscription that Brevo does not have yet", async () => {
    const wrapper = await mountPage()
    expect(wrapper.findAll(".not-synced")).toHaveLength(1)
  })

  it("filters by address, segment and status, from the first page", async () => {
    const wrapper = await mountPage()
    await wrapper.find("input[type=search]").setValue("  jeanne ")
    await wrapper.find("select[name=segment]").setValue("gun_art")
    await wrapper.find("select[name=status]").setValue("pending")
    await wrapper.find("form").trigger("submit")
    await flushPromises()
    expect(apiMock).toHaveBeenLastCalledWith(
      "/admin/newsletter?segment=gun_art&status=pending&search=jeanne&page=1&limit=20",
    )
  })

  it("pages through the list", async () => {
    respond(SUMMARY, [JEANNE], { page: 1, limit: 20, total: 45, totalPages: 3, hasMore: true })
    const wrapper = await mountPage()
    expect(plainText(wrapper.find(".pager").text())).toContain("Page 1 / 3 · 45 contacts")
    await wrapper.find(".pager-next").trigger("click")
    await flushPromises()
    expect(apiMock).toHaveBeenLastCalledWith("/admin/newsletter?page=2&limit=20")
  })

  it("says so when nobody matches", async () => {
    respond(SUMMARY, [], { page: 1, limit: 20, total: 0, totalPages: 0, hasMore: false })
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain("Aucun abonné ne correspond.")
  })
})
