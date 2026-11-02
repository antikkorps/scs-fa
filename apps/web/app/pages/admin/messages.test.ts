// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import Messages from "./messages.vue"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

const MESSAGE = {
  id: "m1",
  name: "Jeanne Armand",
  email: "jeanne@example.fr",
  phone: "06 12 34 56 78",
  subject: "order",
  orderReference: "7C338E18",
  message: "Bonjour,\nOù en est ma commande ?",
  status: "new",
  handledAt: null,
  handledBy: null,
  createdAt: "2026-11-01T10:00:00Z",
}

beforeEach(() => {
  apiMock.mockReset()
  apiMock.mockImplementation((url: string, options?: { method?: string; body?: { status: string } }) =>
    Promise.resolve({
      data: options?.method === "PATCH" ? { ...MESSAGE, status: options.body?.status } : [MESSAGE],
    }),
  )
})

async function mountPage() {
  const wrapper = await mountSuspended(Messages)
  await flushPromises()
  return wrapper
}

describe("admin/messages.vue (audit 2026-11-01, I8b)", () => {
  it("lists the messages to handle first", async () => {
    const wrapper = await mountPage()
    expect(apiMock).toHaveBeenCalledWith("/admin/contact-messages", { query: { status: "new" } })
    const row = wrapper.find("tbody tr")
    expect(row.text()).toContain("Jeanne Armand")
    expect(row.text()).toContain("Commande")
    expect(row.text()).toContain("7C338E18")
  })

  it("opens a message: its full text, a reply by e-mail, and marking it handled", async () => {
    const wrapper = await mountPage()
    await wrapper.find("tbody tr button.open").trigger("click")

    const detail = wrapper.find(".detail")
    expect(detail.text()).toContain("Où en est ma commande ?")
    expect(detail.text()).toContain("06 12 34 56 78")
    const reply = detail.find("a.reply")
    expect(reply.attributes("href")).toBe(
      `mailto:jeanne@example.fr?subject=${encodeURIComponent("Re: Commande — 7C338E18")}`,
    )

    await detail.find("button.handle").trigger("click")
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith("/admin/contact-messages/m1", { method: "PATCH", body: { status: "handled" } })
  })

  it("shows the handled ones on their own tab", async () => {
    const wrapper = await mountPage()
    await wrapper.find("button[data-status='handled']").trigger("click")
    await flushPromises()
    expect(apiMock).toHaveBeenLastCalledWith("/admin/contact-messages", { query: { status: "handled" } })
  })
})
