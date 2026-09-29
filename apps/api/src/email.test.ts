import { CURRENT_TERMS_VERSION, TERMS_SECTIONS } from "@armurier/shared"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }))
vi.mock("nodemailer", () => ({ createTransport: () => ({ sendMail }) }))

const { sendOrderConfirmationEmail } = await import("./email.js")

const base = {
  orderId: "0b7d1f3e-8a51-4c1e-9d0a-2f6b1c3e4d5f",
  orderRef: "0B7D1F3E",
  placedAt: new Date("2026-09-29T14:05:00Z"),
  firstName: "Jean",
  lines: [
    { name: "Carabine <X>", qty: 1 },
    { name: "Boîte de cartouches", qty: 3 },
  ],
  subtotalHt: 1000,
  vipDiscount: 0,
  vat: 200,
  totalTtc: 1200,
  cardTtc: 0,
  transferTtc: 1200,
  transferReference: "SCS-AB12-CD34",
  requiresLegalVerification: true,
  shippingAddress: ["Jean Dupont", "1 rue X", "75001 Paris"],
  termsVersion: CURRENT_TERMS_VERSION,
}

async function send(overrides: Partial<typeof base> = {}) {
  await sendOrderConfirmationEmail("jean@example.fr", { ...base, ...overrides })
  const mail = sendMail.mock.calls[0]?.[0] as { to: string; subject: string; text: string; html: string }
  return mail
}

beforeEach(() => {
  sendMail.mockReset().mockResolvedValue(undefined)
})

describe("sendOrderConfirmationEmail (story 12.1)", () => {
  it("confirms the order: reference, lines, total, delivery address", async () => {
    const mail = await send()
    expect(mail.to).toBe("jean@example.fr")
    expect(mail.subject).toContain("0B7D1F3E")
    expect(mail.text).toContain("- Boîte de cartouches × 3")
    expect(mail.text).toMatch(/Total TTC : 1\s200,00\s€/)
    expect(mail.text).toContain("75001 Paris")
  })

  it("says what to do next: transfer with its reference, documents to upload", async () => {
    const mail = await send()
    expect(mail.text).toContain("en indiquant la référence SCS-AB12-CD34")
    expect(mail.text).toContain("Déposez les pièces justificatives")
    expect(mail.text).not.toContain("par carte bancaire depuis la page")
  })

  it("carries the full CGV text and the withdrawal form — a durable medium, not a link", async () => {
    const mail = await send()
    for (const s of TERMS_SECTIONS) {
      expect(mail.text).toContain(s.title)
      expect(mail.html).toContain(s.title.replaceAll("'", "&#39;"))
    }
    expect(mail.text).toContain("Je vous notifie par la présente ma rétractation")
    expect(mail.text).toMatch(/version du \d{1,2} \S+ \d{4}\)/)
  })

  it("escapes customer-controlled values in the HTML part", async () => {
    const mail = await send({ firstName: "<script>" })
    expect(mail.html).toContain("Carabine &lt;X&gt;")
    expect(mail.html).toContain("Bonjour &lt;script&gt;,")
    expect(mail.html).not.toContain("<script>")
  })
})
