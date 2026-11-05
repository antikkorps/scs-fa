// @vitest-environment nuxt
import type { AdminTeamMember } from "@armurier/shared"
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { clearNuxtData } from "#imports"
import Administrateurs from "./administrateurs.vue"

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
mockNuxtImport("useApi", () => () => apiMock)

const FRED: AdminTeamMember = {
  id: "a1",
  email: "fred@scs-firearms.com",
  firstname: "Fred",
  lastname: "Martin",
  totpEnabled: true,
  invitationExpiresAt: null,
  isMe: true,
}
const LEA: AdminTeamMember = {
  id: "a2",
  email: "lea@example.fr",
  firstname: "Léa",
  lastname: "Bernard",
  totpEnabled: false,
  invitationExpiresAt: "2026-11-07T20:00:00Z",
  isMe: false,
}
const PAUL: AdminTeamMember = {
  ...LEA,
  id: "a3",
  email: "paul@example.fr",
  firstname: "Paul",
  invitationExpiresAt: null,
}

type Wrapper = Awaited<ReturnType<typeof mountPage>>

async function mountPage() {
  const wrapper = await mountSuspended(Administrateurs, { route: "/admin/administrateurs" })
  await flushPromises()
  return wrapper
}

async function confirmWith(form: ReturnType<Wrapper["find"]>) {
  await form.find("input[type=password]").setValue("MonMotDePasse")
  await form.find("input[autocomplete=one-time-code]").setValue("123456")
  await form.trigger("submit")
  await flushPromises()
}

const rowOf = (wrapper: Wrapper, email: string) => wrapper.findAll("tbody tr").find((row) => row.text().includes(email))
const plainText = (text: string) => text.replace(/\s+/g, " ")

beforeEach(() => {
  clearNuxtData()
  apiMock.mockReset()
  apiMock.mockImplementation(async (url: string) =>
    url === "/admin/admins" ? { data: [FRED, LEA, PAUL] } : { data: {} },
  )
})

// Request Franck 2026-11-04: invite helpers as full admins, and take the access back.
describe("admin/administrateurs.vue — the admin team", () => {
  it("shows where each admin's access stands", async () => {
    const wrapper = await mountPage()
    expect(plainText(rowOf(wrapper, FRED.email)?.text() ?? "")).toContain("Actif")
    expect(plainText(rowOf(wrapper, FRED.email)?.text() ?? "")).toContain("vous")
    expect(plainText(rowOf(wrapper, LEA.email)?.text() ?? "")).toContain("Invitation envoyée")
    expect(plainText(rowOf(wrapper, PAUL.email)?.text() ?? "")).toContain("Accès non finalisé")
  })

  it("offers to resend an invitation only to an admin who has not finished, and never to take one's own access", async () => {
    const wrapper = await mountPage()
    expect(rowOf(wrapper, FRED.email)?.find(".resend").exists()).toBe(false)
    expect(rowOf(wrapper, FRED.email)?.find(".revoke").exists()).toBe(false)
    expect(rowOf(wrapper, PAUL.email)?.find(".resend").exists()).toBe(true)
    expect(rowOf(wrapper, PAUL.email)?.find(".revoke").exists()).toBe(true)
  })

  it("invites with the admin's password and code, then lists the team again", async () => {
    const wrapper = await mountPage()
    apiMock.mockClear()
    await wrapper.find("button.open-invite").trigger("click")
    const form = wrapper.find("form.invite")
    await form.find("input[name=invite-email]").setValue(" nora@example.fr ")
    await form.find("input[name=invite-firstname]").setValue("Nora")
    await form.find("input[name=invite-lastname]").setValue("Blanc")
    apiMock.mockResolvedValueOnce({ data: { email: "nora@example.fr", created: true, emailSent: true } })

    await confirmWith(form)

    expect(apiMock).toHaveBeenCalledWith("/admin/admins/invitations", {
      method: "POST",
      body: {
        email: "nora@example.fr",
        firstname: "Nora",
        lastname: "Blanc",
        password: "MonMotDePasse",
        code: "123456",
      },
    })
    expect(wrapper.find("[role=status]").text()).toContain("nora@example.fr")
    expect(apiMock).toHaveBeenCalledWith("/admin/admins")
    expect(wrapper.find("form.invite").exists()).toBe(false)
  })

  it("shows the link to pass on when the e-mail could not leave", async () => {
    const wrapper = await mountPage()
    await wrapper.find("button.open-invite").trigger("click")
    const form = wrapper.find("form.invite")
    await form.find("input[name=invite-email]").setValue("nora@example.fr")
    await form.find("input[name=invite-firstname]").setValue("Nora")
    await form.find("input[name=invite-lastname]").setValue("Blanc")
    apiMock.mockResolvedValueOnce({
      data: {
        email: "nora@example.fr",
        created: true,
        emailSent: false,
        link: "https://x.test/reset-password#token=t",
      },
    })

    await confirmWith(form)

    expect(wrapper.find(".invitation-link").text()).toContain("https://x.test/reset-password#token=t")
  })

  it("says why an invitation is refused", async () => {
    const wrapper = await mountPage()
    await wrapper.find("button.open-invite").trigger("click")
    const form = wrapper.find("form.invite")
    await form.find("input[name=invite-email]").setValue("client@example.fr")
    await form.find("input[name=invite-firstname]").setValue("Jean")
    await form.find("input[name=invite-lastname]").setValue("Client")
    apiMock.mockRejectedValueOnce({ data: { error: "NotAnAdmin" } })

    await confirmWith(form)

    expect(wrapper.find("form.invite [role=alert]").text()).toContain("compte client")
  })

  it("resends an invitation with the same name, after confirmation", async () => {
    const wrapper = await mountPage()
    await rowOf(wrapper, PAUL.email)?.find(".resend").trigger("click")
    apiMock.mockResolvedValueOnce({ data: { email: PAUL.email, created: false, emailSent: true } })

    await confirmWith(wrapper.find("form.team-confirm"))

    expect(apiMock).toHaveBeenCalledWith("/admin/admins/invitations", {
      method: "POST",
      body: { email: PAUL.email, firstname: "Paul", lastname: "Bernard", password: "MonMotDePasse", code: "123456" },
    })
  })

  it("takes an admin's access back after confirmation", async () => {
    const wrapper = await mountPage()
    await rowOf(wrapper, PAUL.email)?.find(".revoke").trigger("click")
    expect(wrapper.find("form.team-confirm").text()).toContain(PAUL.email)
    apiMock.mockResolvedValueOnce({ data: { revoked: true } })

    await confirmWith(wrapper.find("form.team-confirm"))

    expect(apiMock).toHaveBeenCalledWith("/admin/admins/a3/revoke", {
      method: "POST",
      body: { password: "MonMotDePasse", code: "123456" },
    })
    expect(wrapper.find("[role=status]").text()).toContain("paul@example.fr")
  })
})
