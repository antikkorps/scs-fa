import { CURRENT_TERMS_VERSION, TERMS_SECTIONS } from "@armurier/shared"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }))
vi.mock("nodemailer", () => ({ createTransport: () => ({ sendMail }) }))
// Rendering only: the journal (story 12.7c) is covered by email-journal.test.ts.
vi.mock("./audit/record.js", () => ({ recordAuditEvent: vi.fn().mockResolvedValue(undefined) }))

const {
  sendInvoiceAvailableEmail,
  sendLoginCodeEmail,
  sendNewsletterConfirmationEmail,
  sendPasswordResetEmail,
  sendOrderConfirmationEmail,
  sendTransferReminderEmail,
  sendUnpaidOrderCancelledEmail,
} = await import("./email.js")

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
  shippingHt: 20.83,
  vipDiscount: 0,
  vat: 200,
  totalTtc: 1200,
  cardTtc: 0,
  transferTtc: 1200,
  transferReference: "SCS-AB12-CD34",
  requiresLegalVerification: true,
  paymentDueAt: new Date("2026-10-06T14:05:00Z"),
  shippingAddress: ["Jean Dupont", "1 rue X", "75001 Paris"],
  termsVersion: CURRENT_TERMS_VERSION,
}

async function send(overrides: Partial<typeof base> = {}) {
  await sendOrderConfirmationEmail("jean@example.fr", { ...base, ...overrides })
  const mail = sendMail.mock.calls[0]?.[0] as { to: string; subject: string; text: string; html: string }
  return mail
}

const sent = () => sendMail.mock.calls[0]?.[0] as { subject: string; text: string; html: string }

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

  it("says until when the order must be paid, and what happens after (story 12.9a)", async () => {
    const mail = await send()
    expect(mail.text).toContain("avant le 6 octobre 2026")
    expect(mail.text).toContain("annulée")
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

describe("sendInvoiceAvailableEmail (story 12.6)", () => {
  const invoice = {
    orderId: "0b7d1f3e-8a51-4c1e-9d0a-2f6b1c3e4d5f",
    orderRef: "0B7D1F3E",
    kind: "invoice" as "invoice" | "credit_note",
    number: "26-10-1",
    amountTtc: 1336,
  }

  async function sendInvoice(overrides: Partial<typeof invoice> = {}) {
    await sendInvoiceAvailableEmail("jean@example.fr", { ...invoice, ...overrides })
    return sendMail.mock.calls[0]?.[0] as { to: string; subject: string; text: string; html: string }
  }

  it("tells the buyer the invoice is ready, and where to download it", async () => {
    const mail = await sendInvoice()
    expect(mail.to).toBe("jean@example.fr")
    expect(mail.subject).toBe("Votre facture 26-10-1 est disponible — commande 0B7D1F3E")
    expect(mail.text).toMatch(/Montant : 1\s336,00\s€/)
    expect(mail.text).toContain("/compte/commandes/0b7d1f3e-8a51-4c1e-9d0a-2f6b1c3e4d5f")
    expect(mail.html).toContain('href="')
  })

  it("speaks of a credit note for a refund", async () => {
    const mail = await sendInvoice({ kind: "credit_note", number: "26-10-2", amountTtc: 50 })
    expect(mail.subject).toBe("Votre avoir 26-10-2 est disponible — commande 0B7D1F3E")
    expect(mail.text).toContain("remboursement")
  })
})

describe("sendLoginCodeEmail (story 12.8a)", () => {
  it("gives the code, how long it lasts, and what to do if the login is not yours — and no link", async () => {
    await sendLoginCodeEmail("agent@mairie.fr", "042917", 10)
    const mail = sendMail.mock.calls[0]?.[0] as { to: string; subject: string; text: string; html: string }

    expect(mail.to).toBe("agent@mairie.fr")
    expect(mail.subject).toContain("042917")
    expect(mail.text).toContain("042917")
    expect(mail.text).toContain("10 minutes")
    expect(mail.text).toContain("changez-le")
    // Mail filters open links on their own: a link would be spent before the agent reads it.
    expect(mail.html).not.toMatch(/<a\s/i)
  })
})

describe("unpaid order e-mails (story 12.9a)", () => {
  it("reminds the transfer: amount, reference, deadline, where the bank details are", async () => {
    await sendTransferReminderEmail("jean@example.fr", {
      orderId: base.orderId,
      orderRef: base.orderRef,
      firstname: "Jean",
      amountTtc: 1200,
      reference: "SCS-AB12-CD34",
      deadline: new Date("2026-10-06T14:05:00Z"),
    })
    const mail = sent()
    expect(mail.subject).toContain("0B7D1F3E")
    expect(mail.text).toContain("Bonjour Jean,")
    expect(mail.text).toMatch(/1\s200,00\s€/)
    expect(mail.text).toContain("SCS-AB12-CD34")
    expect(mail.text).toContain("6 octobre 2026")
    expect(mail.text).toContain(`/commande/${base.orderId}`)
  })

  it("tells the cancellation, and that nothing was charged", async () => {
    await sendUnpaidOrderCancelledEmail("jean@example.fr", {
      orderId: base.orderId,
      orderRef: base.orderRef,
      firstname: null,
    })
    const mail = sent()
    expect(mail.subject).toBe("Commande 0B7D1F3E annulée")
    expect(mail.text).toContain("Bonjour,")
    expect(mail.text).toContain("Aucune somme ne vous a été prélevée")
  })
})

// Story 12.9g — single-use tokens travel in the URL fragment, which no server,
// proxy or audience measurement sees. Unsubscribing keeps its query token: the
// mailbox's one-click unsubscribe posts to that very URL.
describe("link tokens", () => {
  const TOKEN = "t".repeat(43)

  it("puts the reset token in the link's fragment", async () => {
    await sendPasswordResetEmail("jean@example.fr", TOKEN)
    const mail = sent()
    expect(mail.text).toContain(`/reset-password#token=${TOKEN}`)
    expect(mail.text).not.toContain("?token=")
  })

  it("puts the confirmation token in the fragment, the unsubscribe token in the query", async () => {
    await sendNewsletterConfirmationEmail("jean@example.fr", {
      confirmToken: TOKEN,
      unsubscribeToken: "u".repeat(43),
      segmentLabels: ["Armurerie"],
    })
    const mail = sent()
    expect(mail.text).toContain(`/newsletter/confirmation#token=${TOKEN}`)
    expect(mail.text).not.toContain(`?token=${TOKEN}`)
    expect(mail.text).toContain(`/newsletter/desabonnement?token=${"u".repeat(43)}`)
  })
})
