import {
  escapeHtml,
  type LegalDocRejectionReason,
  type LegalDocType,
  NEWSLETTER_CONFIRM_TOKEN_TTL_HOURS,
  renderInlinesHtml,
  renderInlinesText,
  renderTermsHtml,
  renderTermsText,
  type TermsInline,
} from "@armurier/shared"
import { createTransport, type SendMailOptions } from "nodemailer"
import { type AuditEvent, recordAuditEvent } from "./audit/record.js"
import { env } from "./env.js"

const transporter = createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
})

/** What a customer e-mail is about, for its journal line (story 12.7c). */
export interface EmailAbout {
  orderId?: string
  userId?: string
  contactId?: string
}

type EmailType =
  | "password_reset"
  | "legal_doc_approved"
  | "legal_doc_rejected"
  | "shipment_shipped"
  | "newsletter_confirmation"
  | "order_confirmation"
  | "invoice_available"

/** The order first (its history), else the account, else the newsletter contact. */
function journalEntity(about: EmailAbout): { entityType: string; entityId: string | null } {
  if (about.orderId) return { entityType: "order", entityId: about.orderId }
  if (about.userId) return { entityType: "user", entityId: about.userId }
  if (about.contactId) return { entityType: "newsletter_contact", entityId: about.contactId }
  return { entityType: "email", entityId: null }
}

/** Nodemailer's error code (`EENVELOPE`, `ECONNECTION`…), never its message. */
function smtpErrorCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code
  return `smtp.${typeof code === "string" ? code : "unknown"}`
}

/**
 * Send a customer e-mail and journal it: sent with its SMTP message id, or
 * failed with the SMTP code. A failure still reaches the caller. A journal
 * line that cannot be written only raises a warning: the e-mail has left,
 * and failing here would make the caller send it again.
 */
async function deliver(type: EmailType, about: EmailAbout, mail: SendMailOptions): Promise<void> {
  const journal = (event: Pick<AuditEvent, "result" | "error" | "messageId">) =>
    recordAuditEvent({
      ...journalEntity(about),
      userRole: "system",
      orderId: about.orderId ?? null,
      action: `email.${type}.${event.result === "failure" ? "failed" : "sent"}`,
      newValue: { recipient: mail.to },
      ...event,
    }).catch((error: unknown) => {
      process.emitWarning(`E-mail journal line not written (${type}): ${String(error)}`)
    })

  let info: { messageId?: string } | undefined
  try {
    info = await transporter.sendMail(mail)
  } catch (error) {
    await journal({ result: "failure", error: smtpErrorCode(error) })
    throw error
  }
  await journal({ result: "success", messageId: info?.messageId ?? null })
}

export async function sendPasswordResetEmail(to: string, token: string, about: EmailAbout = {}): Promise<void> {
  const resetUrl = `${env.WEB_BASE_URL}/reset-password?token=${token}`

  await deliver("password_reset", about, {
    from: env.SMTP_FROM,
    to,
    subject: "Reset your password",
    text: `You requested a password reset.\n\nClick the link below (valid 1 hour):\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
    html: `
      <p>You requested a password reset.</p>
      <p><a href="${resetUrl}">Reset my password</a> (valid 1 hour)</p>
      <p>If you did not request this, ignore this email.</p>
    `,
  })
}

const DOC_TYPE_LABELS: Record<LegalDocType, string> = {
  cni: "identity card",
  permis_chasse: "hunting permit",
  autorisation_det: "detention authorization",
  sia: "SIA certificate",
  expertise: "expertise certificate",
}

const REJECTION_REASON_LABELS: Record<LegalDocRejectionReason, string> = {
  document_expired: "the document has expired",
  document_illegible: "the document is not legible",
  wrong_document_type: "the document does not match the expected type",
  information_mismatch: "the information does not match your account details",
  document_incomplete: "the document is incomplete",
  underage: "the legal age requirement is not met",
  suspected_fraud: "the document could not be authenticated",
  other: "see the details below",
}

export async function sendLegalDocApprovedEmail(
  to: string,
  doc: { docType: LegalDocType },
  about: EmailAbout = {},
): Promise<void> {
  const label = DOC_TYPE_LABELS[doc.docType]
  await deliver("legal_doc_approved", about, {
    from: env.SMTP_FROM,
    to,
    subject: "Your legal document has been approved",
    text: `Good news!\n\nYour ${label} has been reviewed and approved.\n\nYou can now proceed with your orders requiring this document.`,
    html: `
      <p>Good news!</p>
      <p>Your <strong>${label}</strong> has been reviewed and <strong>approved</strong>.</p>
      <p>You can now proceed with your orders requiring this document.</p>
    `,
  })
}

export type SlaBreachItem = {
  customerName: string
  docType: LegalDocType
  deadline: Date
  hoursOverdue: number
}

/**
 * Internal digest sent to admins when one or more legal documents have blown
 * past their 48h review SLA. Best-effort, sent once per breach (see sla.ts).
 */
export async function sendLegalDocSlaBreachEmail(to: string[], breaches: SlaBreachItem[]): Promise<void> {
  if (to.length === 0 || breaches.length === 0) return

  const queueUrl = `${env.WEB_BASE_URL}/admin/legal-documents`
  const line = (b: SlaBreachItem) =>
    `${b.customerName} — ${DOC_TYPE_LABELS[b.docType]} (deadline ${b.deadline.toISOString()}, ${b.hoursOverdue}h overdue)`
  const rows = breaches
    .map(
      (b) =>
        `<li>${escapeHtml(b.customerName)} — <strong>${DOC_TYPE_LABELS[b.docType]}</strong> ` +
        `(deadline ${b.deadline.toISOString()}, <strong>${b.hoursOverdue}h overdue</strong>)</li>`,
    )
    .join("")

  await transporter.sendMail({
    from: env.SMTP_FROM,
    to,
    subject: `[Action required] ${breaches.length} legal document(s) past the 48h review SLA`,
    text:
      `${breaches.length} legal document(s) have exceeded the 48h validation SLA and are still pending:\n\n` +
      `${breaches.map(line).join("\n")}\n\nReview them now: ${queueUrl}`,
    html:
      `<p><strong>${breaches.length}</strong> legal document(s) have exceeded the 48h validation SLA and are still pending:</p>` +
      `<ul>${rows}</ul>` +
      `<p><a href="${queueUrl}">Open the validation queue</a></p>`,
  })
}

export type ErrorAlertItem = {
  signature: string
  statusCode: number
  method: string
  url: string
  reqId: string
  message: string
  stack?: string
}

/**
 * Internal alert sent to admins when the API returns a server error (5xx).
 * Throttled per error signature upstream (see logging/alerting.ts) so this is at
 * most one mail per distinct failure per cooldown window. Best-effort.
 */
export async function sendErrorAlertEmail(to: string[], item: ErrorAlertItem): Promise<void> {
  if (to.length === 0) return

  const summary = `${item.method} ${item.url} → ${item.statusCode}`
  const stackText = item.stack ? `\n\nStack:\n${item.stack}` : ""
  await transporter.sendMail({
    from: env.SMTP_FROM,
    to,
    subject: `[API error] ${item.statusCode} on ${item.method} ${item.url}`,
    text:
      `A server error occurred.\n\n${summary}\nRequest id: ${item.reqId}\nError: ${item.message}` +
      `${stackText}\n\n(Further occurrences of this error are throttled.)`,
    html:
      `<p>A server error occurred.</p>` +
      `<p><strong>${escapeHtml(summary)}</strong><br/>Request id: <code>${escapeHtml(item.reqId)}</code></p>` +
      `<p>Error: ${escapeHtml(item.message)}</p>` +
      (item.stack ? `<pre>${escapeHtml(item.stack)}</pre>` : "") +
      `<p><em>Further occurrences of this error are throttled.</em></p>`,
  })
}

export async function sendLegalDocRejectedEmail(
  to: string,
  doc: { docType: LegalDocType; reason: LegalDocRejectionReason; notes?: string | null },
  about: EmailAbout = {},
): Promise<void> {
  const label = DOC_TYPE_LABELS[doc.docType]
  const reasonLabel = REJECTION_REASON_LABELS[doc.reason]
  const notesText = doc.notes ? `\n\nDetails: ${doc.notes}` : ""
  await deliver("legal_doc_rejected", about, {
    from: env.SMTP_FROM,
    to,
    subject: "Your legal document was rejected",
    text: `Your ${label} has been reviewed and rejected.\n\nReason: ${reasonLabel}.${notesText}\n\nPlease upload a new document from your account.`,
    html: `
      <p>Your <strong>${label}</strong> has been reviewed and <strong>rejected</strong>.</p>
      <p>Reason: ${reasonLabel}.</p>
      ${doc.notes ? `<p>Details: ${escapeHtml(doc.notes)}</p>` : ""}
      <p>Please upload a new document from your account.</p>
    `,
  })
}

export type ShipmentShippedEmail = {
  orderId: string
  orderRef: string
  /** Rank of this parcel in the order, and how many parcels the order has. */
  position: number
  total: number
  carrierLabel: string
  trackingNumber: string | null
  trackingUrl: string | null
  items: Array<{ label: string; qty: number; part: number; parts: number }>
}

/**
 * "Your parcel is on its way" (Story 11.9) — one mail per parcel, the order
 * being possibly split (a category B firearm travels in two). Idempotence is
 * the caller's job (see shipments/service.ts).
 */
export async function sendShipmentShippedEmail(to: string, p: ShipmentShippedEmail): Promise<void> {
  const orderUrl = `${env.WEB_BASE_URL}/compte/commandes/${p.orderId}`
  const parcel = p.total > 1 ? `Votre colis ${p.position}/${p.total}` : "Votre colis"
  const itemLabel = (i: ShipmentShippedEmail["items"][number]) =>
    `${i.label}${i.qty > 1 ? ` × ${i.qty}` : ""}${i.parts > 1 ? ` (partie ${i.part}/${i.parts})` : ""}`
  const trackingText = [
    p.trackingNumber ? `Numéro de suivi : ${p.trackingNumber}` : "",
    p.trackingUrl ? `Suivre le colis : ${p.trackingUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n")
  const splitNote =
    p.total > 1 ? "Votre commande est expédiée en plusieurs colis : un e-mail vous est envoyé à chaque départ." : ""

  await deliver(
    "shipment_shipped",
    { orderId: p.orderId },
    {
      from: env.SMTP_FROM,
      to,
      subject: `${parcel} est en route — commande ${p.orderRef}`,
      text:
        `${parcel} de la commande ${p.orderRef} a été remis à ${p.carrierLabel}.\n\n` +
        `Contenu :\n${p.items.map((i) => `- ${itemLabel(i)}`).join("\n")}\n\n` +
        (trackingText ? `${trackingText}\n\n` : "") +
        (splitNote ? `${splitNote}\n\n` : "") +
        `Le détail de votre commande : ${orderUrl}`,
      html:
        `<p>${parcel} de la commande <strong>${escapeHtml(p.orderRef)}</strong> a été remis à ` +
        `<strong>${escapeHtml(p.carrierLabel)}</strong>.</p>` +
        `<p>Contenu :</p><ul>${p.items.map((i) => `<li>${escapeHtml(itemLabel(i))}</li>`).join("")}</ul>` +
        (p.trackingNumber ? `<p>Numéro de suivi : <strong>${escapeHtml(p.trackingNumber)}</strong></p>` : "") +
        (p.trackingUrl ? `<p><a href="${escapeHtml(p.trackingUrl)}">Suivre le colis</a></p>` : "") +
        (splitNote ? `<p>${splitNote}</p>` : "") +
        `<p><a href="${orderUrl}">Voir ma commande</a></p>`,
    },
  )
}

/**
 * Double opt-in confirmation (Story 11.4). Sent to an address that has just been
 * captured: nothing is mailed to it — and it never reaches the sending provider
 * — until this link is followed, which is what makes the opt-in provable.
 *
 * The unsubscribe link travels in the same mail on purpose: withdrawing consent
 * must be as easy as giving it, including for someone whose address was entered
 * by a third party.
 */
export async function sendNewsletterConfirmationEmail(
  to: string,
  params: { confirmToken: string; unsubscribeToken: string; segmentLabels: string[] },
  about: EmailAbout = {},
): Promise<void> {
  const confirmUrl = `${env.WEB_BASE_URL}/newsletter/confirmation?token=${params.confirmToken}`
  const unsubscribeUrl = `${env.WEB_BASE_URL}/newsletter/desabonnement?token=${params.unsubscribeToken}`
  const listText = params.segmentLabels.map((label) => `- ${label}`).join("\n")
  const listHtml = params.segmentLabels.map((label) => `<li>${escapeHtml(label)}</li>`).join("")

  await deliver("newsletter_confirmation", about, {
    from: env.SMTP_FROM,
    to,
    subject: "Confirmez votre inscription à la newsletter SCS Firearms",
    // One-click unsubscribe headers (RFC 8058): mail clients surface a native
    // unsubscribe button, which keeps complaints off the spam button.
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    text:
      `Vous avez demandé à recevoir nos actualités :\n\n${listText}\n\n` +
      `Confirmez votre inscription (lien valable ${NEWSLETTER_CONFIRM_TOKEN_TTL_HOURS} heures) :\n${confirmUrl}\n\n` +
      `Sans confirmation de votre part, aucune adresse n'est conservée et vous ne recevrez rien.\n\n` +
      `Se désabonner à tout moment : ${unsubscribeUrl}`,
    html:
      `<p>Vous avez demandé à recevoir nos actualités :</p>` +
      `<ul>${listHtml}</ul>` +
      `<p><a href="${confirmUrl}">Confirmer mon inscription</a> ` +
      `(lien valable ${NEWSLETTER_CONFIRM_TOKEN_TTL_HOURS} heures)</p>` +
      `<p>Sans confirmation de votre part, aucune adresse n'est conservée et vous ne recevrez rien.</p>` +
      `<p><a href="${unsubscribeUrl}">Se désabonner</a> à tout moment.</p>`,
  })
}

export type OrderConfirmationEmail = {
  orderId: string
  orderRef: string
  placedAt: Date
  firstName: string | null
  lines: Array<{ name: string; qty: number }>
  subtotalHt: number
  vipDiscount: number
  /** Delivery, HT (story 12.3) — its VAT is in `vat`, and `totalTtc` includes it. */
  shippingHt: number
  vat: number
  totalTtc: number
  /** Card-payable part (0 when none). */
  cardTtc: number
  /** Bank-transfer part (0 when none), with the reference the transfer must carry. */
  transferTtc: number
  transferReference: string | null
  requiresLegalVerification: boolean
  /** Delivery address, one line per entry. */
  shippingAddress: string[]
  /** CGV version accepted with the order (ISO date). */
  termsVersion: string
}

const EUROS = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" })
const PARIS_DATE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "Europe/Paris" })
const PARIS_DATETIME = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Europe/Paris",
})

const SELLER: TermsInline[] = [
  "Vendeur : ",
  { fact: "companyName", label: "raison sociale" },
  ", ",
  { fact: "address", label: "adresse postale" },
  " — ",
  { fact: "email", label: "adresse e-mail de contact" },
]

/**
 * Order confirmation (story 12.1) — the confirmation on a durable medium that
 * art. L221-13 of the Code de la consommation requires: what was ordered, what
 * happens next, who the seller is, and the FULL text of the CGV the customer
 * accepted, with the withdrawal form. A link to /cgv would not do: a web page
 * the seller can change is not a durable medium.
 *
 * Idempotence and retries are the caller's job (orders/confirmation.ts).
 */
export async function sendOrderConfirmationEmail(to: string, o: OrderConfirmationEmail): Promise<void> {
  const site = { siteUrl: env.WEB_BASE_URL }
  const orderUrl = `${env.WEB_BASE_URL}/commande/${o.orderId}`
  const hello = o.firstName ? `Bonjour ${o.firstName},` : "Bonjour,"
  const placed = PARIS_DATETIME.format(o.placedAt)
  const termsDate = PARIS_DATE.format(new Date(o.termsVersion))

  const totals: Array<[string, string]> = [
    ["Sous-total HT", EUROS.format(o.subtotalHt)],
    ...(o.vipDiscount > 0 ? ([["Remise VIP", `− ${EUROS.format(o.vipDiscount)}`]] as Array<[string, string]>) : []),
    ["Livraison HT", o.shippingHt > 0 ? EUROS.format(o.shippingHt) : "Offerte"],
    ["TVA", EUROS.format(o.vat)],
    ["Total TTC", EUROS.format(o.totalTtc)],
  ]

  const steps: string[] = []
  if (o.cardTtc > 0)
    steps.push(`Réglez ${EUROS.format(o.cardTtc)} par carte bancaire depuis la page de votre commande.`)
  if (o.transferTtc > 0) {
    steps.push(
      `Réglez ${EUROS.format(o.transferTtc)} par virement${o.transferReference ? `, en indiquant la référence ${o.transferReference}` : ""} : les coordonnées bancaires figurent sur la page de votre commande.`,
    )
  }
  if (o.requiresLegalVerification) {
    steps.push(
      "Déposez les pièces justificatives demandées depuis votre espace client : la commande est expédiée une fois toutes les pièces validées.",
    )
  }

  const withdrawal =
    "Vous disposez de 14 jours à compter de la réception de vos articles pour exercer votre droit de rétractation, dans les conditions de l'article 8 des conditions générales ci-dessous. Un formulaire de rétractation figure à la fin de cet e-mail."
  const termsIntro = `Vous avez accepté nos conditions générales de vente (version du ${termsDate}) en passant commande. Leur texte intégral figure ci-dessous : conservez cet e-mail.`

  await deliver(
    "order_confirmation",
    { orderId: o.orderId },
    {
      from: env.SMTP_FROM,
      to,
      subject: `Confirmation de votre commande ${o.orderRef} — SCS Firearms`,
      text:
        `${hello}\n\nNous avons bien reçu votre commande ${o.orderRef} du ${placed}.\n\n` +
        `Articles :\n${o.lines.map((l) => `- ${l.name}${l.qty > 1 ? ` × ${l.qty}` : ""}`).join("\n")}\n\n` +
        `${totals.map(([k, v]) => `${k} : ${v}`).join("\n")}\n\n` +
        (steps.length ? `Prochaines étapes :\n${steps.map((s) => `- ${s}`).join("\n")}\n\n` : "") +
        `Livraison à :\n${o.shippingAddress.join("\n")}\n\n` +
        `Suivre votre commande : ${orderUrl}\n\n` +
        `${withdrawal}\n\n${renderInlinesText(SELLER, site)}\n\n` +
        `----------------------------------------\nCONDITIONS GÉNÉRALES DE VENTE\n\n${termsIntro}\n\n${renderTermsText(site)}\n`,
      html:
        `<p>${escapeHtml(hello)}</p>` +
        `<p>Nous avons bien reçu votre commande <strong>${escapeHtml(o.orderRef)}</strong> du ${escapeHtml(placed)}.</p>` +
        `<p>Articles :</p><ul>${o.lines.map((l) => `<li>${escapeHtml(l.name)}${l.qty > 1 ? ` × ${l.qty}` : ""}</li>`).join("")}</ul>` +
        `<table role="presentation">${totals.map(([k, v]) => `<tr><td>${k}</td><td style="text-align:right;padding-left:1.5em">${v}</td></tr>`).join("")}</table>` +
        (steps.length
          ? `<p>Prochaines étapes :</p><ul>${steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>`
          : "") +
        `<p>Livraison à :<br>${o.shippingAddress.map(escapeHtml).join("<br>")}</p>` +
        `<p><a href="${orderUrl}">Suivre ma commande</a></p>` +
        `<p>${escapeHtml(withdrawal)}</p><p>${renderInlinesHtml(SELLER, site)}</p>` +
        `<hr><h2>Conditions générales de vente</h2><p>${escapeHtml(termsIntro)}</p>${renderTermsHtml(site)}`,
    },
  )
}

export interface InvoiceAvailableEmail {
  orderId: string
  orderRef: string
  kind: "invoice" | "credit_note"
  number: string
  amountTtc: number
}

/**
 * "Your invoice is available" (story 12.6): sent by SCS Firearms once Henrri has
 * issued the invoice — or the credit note of a refund. The PDF is not attached:
 * it is downloaded from the order page, behind the customer's session.
 * Idempotence is the queue's job (`henrri_documents.customer_notified_at`).
 */
export async function sendInvoiceAvailableEmail(to: string, d: InvoiceAvailableEmail): Promise<void> {
  const orderUrl = `${env.WEB_BASE_URL}/compte/commandes/${d.orderId}`
  const document = d.kind === "invoice" ? `Votre facture ${d.number}` : `Votre avoir ${d.number}`
  const context =
    d.kind === "invoice"
      ? `pour la commande ${d.orderRef} est disponible.`
      : `suite au remboursement de la commande ${d.orderRef} est disponible.`
  const amount = EUROS.format(d.amountTtc)

  await deliver(
    "invoice_available",
    { orderId: d.orderId },
    {
      from: env.SMTP_FROM,
      to,
      subject: `${document} est disponible — commande ${d.orderRef}`,
      text:
        `${document} ${context}\n\n` +
        `Montant : ${amount}\n\n` +
        `Téléchargez-la depuis votre espace client : ${orderUrl}`,
      html:
        `<p>${escapeHtml(document)} ${escapeHtml(context)}</p>` +
        `<p>Montant : <strong>${escapeHtml(amount)}</strong></p>` +
        `<p><a href="${orderUrl}">Télécharger depuis mon espace client</a></p>`,
    },
  )
}
