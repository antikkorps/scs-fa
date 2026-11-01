// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime"
import { flushPromises } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AccountDataRights from "./AccountDataRights.vue"

const { apiMock, logoutMock, navigateToMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  logoutMock: vi.fn(),
  navigateToMock: vi.fn(),
}))
mockNuxtImport("useApi", () => () => apiMock)
mockNuxtImport("useAuth", () => () => ({ logout: logoutMock }))
mockNuxtImport("navigateTo", () => navigateToMock)

/** A FetchError-shaped rejection carrying the API's error code. */
const apiError = (status: number, error: string) =>
  Object.assign(new Error(error), { response: { status, _data: { error } }, data: { error } })

function serve(appEnabled: boolean, answers: Record<string, () => unknown> = {}) {
  apiMock.mockImplementation(async (url: string) => {
    if (url === "/auth/totp") return { data: { enabled: appEnabled, required: false } }
    for (const [suffix, answer] of Object.entries(answers)) if (url.endsWith(suffix)) return answer()
    return {}
  })
}

const callTo = (suffix: string) => apiMock.mock.calls.find(([url]) => String(url).endsWith(suffix))

beforeEach(() => {
  apiMock.mockReset()
  logoutMock.mockReset().mockResolvedValue(undefined)
  navigateToMock.mockReset()
  URL.createObjectURL = vi.fn(() => "blob:export")
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("AccountDataRights (story 12.11)", () => {
  describe("the export", () => {
    it("downloads the file once the password is confirmed", async () => {
      serve(false, { "/me/export": () => new Blob(["{}"], { type: "application/json" }) })
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
      const wrapper = await mountSuspended(AccountDataRights, { props: { deletable: true } })
      await flushPromises()

      expect(wrapper.find("form.export input[name='export-code']").exists()).toBe(false)
      await wrapper.find("form.export input[name='export-password']").setValue("MotDePasse123!")
      await wrapper.find("form.export").trigger("submit")
      await flushPromises()

      expect(callTo("/auth/me/export")?.[1]).toEqual({
        method: "POST",
        body: { password: "MotDePasse123!" },
        responseType: "blob",
      })
      expect(click).toHaveBeenCalledOnce()
      expect((wrapper.find("form.export input[name='export-password']").element as HTMLInputElement).value).toBe("")
    })

    it("asks for the app's code too when the account has the app on", async () => {
      serve(true, { "/me/export": () => new Blob(["{}"]) })
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
      const wrapper = await mountSuspended(AccountDataRights, { props: { deletable: true } })
      await flushPromises()

      await wrapper.find("form.export input[name='export-password']").setValue("MotDePasse123!")
      await wrapper.find("form.export input[name='export-code']").setValue("123456")
      await wrapper.find("form.export").trigger("submit")
      await flushPromises()

      expect(callTo("/auth/me/export")?.[1]?.body).toEqual({ password: "MotDePasse123!", code: "123456" })
    })

    it("says so when the password is wrong, though the refusal comes back as a file", async () => {
      // The export asks for a blob: its error body is a blob too, not parsed JSON.
      const refusal = new Blob([JSON.stringify({ error: "InvalidCredentials" })], { type: "application/json" })
      serve(false, {
        "/me/export": () => {
          throw Object.assign(new Error("Forbidden"), { response: { status: 403, _data: refusal }, data: refusal })
        },
      })
      const wrapper = await mountSuspended(AccountDataRights, { props: { deletable: true } })
      await flushPromises()

      await wrapper.find("form.export input[name='export-password']").setValue("faux")
      await wrapper.find("form.export").trigger("submit")
      await flushPromises()

      expect(wrapper.find("form.export [role='alert']").text()).toBe("Mot de passe incorrect.")
    })
  })

  describe("the deletion", () => {
    async function openDeletion(appEnabled = false, answers: Record<string, () => unknown> = {}) {
      serve(appEnabled, answers)
      const wrapper = await mountSuspended(AccountDataRights, { props: { deletable: true } })
      await flushPromises()
      expect(wrapper.find("form.delete").exists()).toBe(false)
      await wrapper.find("button.delete-open").trigger("click")
      return wrapper
    }

    it("tells what goes and what the law keeps, and waits for an explicit confirmation", async () => {
      const wrapper = await openDeletion()
      const text = wrapper.find("form.delete").text()
      expect(text).toMatch(/définitive/i)
      expect(text).toMatch(/10 ans/)

      await wrapper.find("form.delete input[name='delete-password']").setValue("MotDePasse123!")
      expect(wrapper.find("form.delete button[type='submit']").attributes("disabled")).toBeDefined()
      await wrapper.find("form.delete input[name='delete-confirm']").setValue(true)
      expect(wrapper.find("form.delete button[type='submit']").attributes("disabled")).toBeUndefined()
    })

    it("deletes, ends the session and leaves for the farewell page", async () => {
      const wrapper = await openDeletion(false, { "/me/delete": () => ({ data: { deleted: true } }) })

      await wrapper.find("form.delete input[name='delete-password']").setValue("MotDePasse123!")
      await wrapper.find("form.delete input[name='delete-confirm']").setValue(true)
      await wrapper.find("form.delete").trigger("submit")
      await flushPromises()

      expect(callTo("/auth/me/delete")?.[1]).toEqual({ method: "POST", body: { password: "MotDePasse123!" } })
      expect(logoutMock).toHaveBeenCalledOnce()
      expect(navigateToMock).toHaveBeenCalledWith("/compte-supprime")
    })

    it("explains why it waits while an order is running", async () => {
      const wrapper = await openDeletion(false, {
        "/me/delete": () => {
          throw apiError(409, "OrderInProgress")
        },
      })

      await wrapper.find("form.delete input[name='delete-password']").setValue("MotDePasse123!")
      await wrapper.find("form.delete input[name='delete-confirm']").setValue(true)
      await wrapper.find("form.delete").trigger("submit")
      await flushPromises()

      expect(wrapper.find("form.delete [role='alert']").text()).toMatch(/commande est encore en cours/)
      expect(logoutMock).not.toHaveBeenCalled()
    })

    it("is not offered where SCS closes the account", async () => {
      serve(false)
      const wrapper = await mountSuspended(AccountDataRights, { props: { deletable: false } })
      await flushPromises()

      expect(wrapper.find("button.delete-open").exists()).toBe(false)
      expect(wrapper.text()).toMatch(/contactez-nous/i)
    })
  })
})
