import { beforeEach, describe, expect, it, vi } from "vitest"

// Nitro auto-imports the h3 helpers and server utils; outside its runtime the
// route sees them as globals, so the test provides them before importing it.
const callAuthApi = vi.fn()
const finishLogin = vi.fn()
const BODY = { email: "buyer@example.com", password: "MotDePasseTresLong123!" }
const CHECK_INBOX = { message: "Check your inbox to continue." }

vi.stubGlobal("defineEventHandler", (handler: unknown) => handler)
vi.stubGlobal("readBody", async () => BODY)
vi.stubGlobal("callAuthApi", callAuthApi)
vi.stubGlobal("finishLogin", finishLogin)

const { default: register } = (await import("./register.post")) as unknown as {
  default: (event: object) => Promise<unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  callAuthApi.mockResolvedValue(CHECK_INBOX)
})

// Sign-up without enumeration (story 12.14): a session opened after the sign-up
// would tell a free address (signed in, or asked for a code) from a taken one.
describe("BFF POST /bff/auth/register", () => {
  it("forwards the sign-up and answers with the API's message", async () => {
    const event = {}
    const answer = await register(event)

    expect(callAuthApi).toHaveBeenCalledWith(event, "/auth/register", BODY)
    expect(answer).toEqual(CHECK_INBOX)
  })

  it("never logs in after the sign-up", async () => {
    await register({})

    expect(callAuthApi).toHaveBeenCalledOnce()
    expect(finishLogin).not.toHaveBeenCalled()
  })
})
