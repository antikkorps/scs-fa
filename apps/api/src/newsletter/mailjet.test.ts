import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MailjetNewsletterService } from "./mailjet.js"

const CONFIG = {
  apiKey: "public-key",
  secretKey: "private-key",
  listIds: { armurerie: 11, collection: 12, gun_art: 13 },
}
const AUTH = `Basic ${Buffer.from("public-key:private-key").toString("base64")}`
const EMAIL = "jean@example.fr"

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("Mailjet newsletter driver", () => {
  const fetchMock = vi.fn<typeof fetch>()

  /** Every call as [method, url, parsed body]. */
  const calls = () =>
    fetchMock.mock.calls.map(([url, init]) => [
      init?.method,
      String(url),
      init?.body ? JSON.parse(String(init.body)) : undefined,
    ])

  beforeEach(() => {
    fetchMock.mockReset().mockImplementation(async () => json(201))
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it("refuses to start without its keys or a list per segment", () => {
    expect(() => new MailjetNewsletterService({ ...CONFIG, apiKey: undefined })).toThrow("MAILJET_API_KEY")
    expect(() => new MailjetNewsletterService({ ...CONFIG, secretKey: undefined })).toThrow("MAILJET_SECRET_KEY")
    expect(
      () => new MailjetNewsletterService({ ...CONFIG, listIds: { ...CONFIG.listIds, gun_art: undefined } }),
    ).toThrow('"gun_art"')
  })

  it("subscribes the contact to its segments' lists and unsubscribes it from the others", async () => {
    await new MailjetNewsletterService(CONFIG).syncContact({ email: EMAIL, segments: ["armurerie", "gun_art"] })

    expect(calls()).toEqual([
      ["POST", "https://api.mailjet.com/v3/REST/contactslist/11/managecontact", { Email: EMAIL, Action: "addforce" }],
      ["POST", "https://api.mailjet.com/v3/REST/contactslist/12/managecontact", { Email: EMAIL, Action: "unsub" }],
      ["POST", "https://api.mailjet.com/v3/REST/contactslist/13/managecontact", { Email: EMAIL, Action: "addforce" }],
    ])
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("authorization")).toBe(AUTH)
  })

  it("erases the contact through Mailjet's GDPR deletion, found by its address", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { Count: 1, Data: [{ ID: 987, Email: EMAIL }], Total: 1 }))
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))

    await new MailjetNewsletterService(CONFIG).deleteContact(EMAIL)

    expect(calls()).toEqual([
      ["GET", "https://api.mailjet.com/v3/REST/contact/jean%40example.fr", undefined],
      ["DELETE", "https://api.mailjet.com/v4/contacts/987", undefined],
    ])
  })

  it("treats a contact Mailjet does not know as already erased", async () => {
    fetchMock.mockResolvedValueOnce(json(404))
    await expect(new MailjetNewsletterService(CONFIG).deleteContact(EMAIL)).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("does not read a success body it has no use for: it echoes the address", async () => {
    fetchMock.mockImplementation(async () => new Response(`<html>${EMAIL}</html>`, { status: 201 }))
    await expect(
      new MailjetNewsletterService(CONFIG).syncContact({ email: EMAIL, segments: ["armurerie"] }),
    ).resolves.toBeUndefined()
  })

  it("keeps the address out of a failed lookup's message too", async () => {
    fetchMock.mockImplementation(async () => json(500))
    const erase = new MailjetNewsletterService(CONFIG).deleteContact(EMAIL)
    await expect(erase).rejects.toThrow("Mailjet GET /v3/REST/contact/… failed with 500")
    await expect(erase).rejects.not.toThrow(EMAIL)
    await expect(erase).rejects.not.toThrow("jean%40example.fr")
  })

  it("fails loudly on an error, without the address in the message", async () => {
    fetchMock.mockImplementation(async () => json(401, { ErrorMessage: `bad key for ${EMAIL}` }))
    const sync = new MailjetNewsletterService(CONFIG).syncContact({ email: EMAIL, segments: ["armurerie"] })
    await expect(sync).rejects.toThrow("Mailjet POST /v3/REST/contactslist/11/managecontact failed with 401")
    await expect(sync).rejects.not.toThrow(EMAIL)
  })
})
