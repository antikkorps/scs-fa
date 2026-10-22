import {
  escapeHtml,
  type LegalDocRejectionReason,
  type LegalDocType,
  NEWSLETTER_CONFIRM_TOKEN_TTL_HOURS,
  type OrganisationType,
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
  | "login_code"
  | "organisation_request_received"
  | "organisation_approved"
  | "organisation_rejected"
  | "organisation_suspended"
  | "organisation_reinstated"
  | "quote_request_received"
  | "transfer_reminder"
  | "unpaid_order_cancelled"

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

/** Story 12.8a — the code that completes a login. Short-lived, so no link: a code survives mail scanners that open links. */
export async function sendLoginCodeEmail(
  to: string,
  code: string,
  validMinutes: number,
  about: EmailAbout = {},
): Promise<void> {
  await deliver("login_code", about, {
    from: env.SMTP_FROM,
    to,
    subject: `${code} — votre code de connexion SCS Firearms`,
    text:
      `Votre code de connexion : ${code}\n\n` +
      `Il est valable ${validMinutes} minutes et ne sert qu'une fois.\n\n` +
      `Si vous n'êtes pas à l'origine de cette connexion, quelqu'un connaît votre mot de passe : changez-le sans attendre.`,
    html:
      `<p>Votre code de connexion :</p>` +
      `<p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>` +
      `<p>Il est valable ${validMinutes} minutes et ne sert qu'une fois.</p>` +
      `<p>Si vous n'êtes pas à l'origine de cette connexion, quelqu'un connaît votre mot de passe : changez-le sans attendre.</p>`,
  })
}

// Story 12.8b — the pro account's follow-up e-mails, in French like the site.
const ORGANISATION_TYPE_LABELS: Record<OrganisationType, string> = {
  armurier: "Armurier",
  club: "Club de tir",
  securite_privee: "Sécurité privée",
  administration: "Administration",
}

const PRO_SPACE_URL = () => `${env.WEB_BASE_URL}/compte`

/** One short French e-mail: paragraphs of plain text, escaped into the HTML part. */
async function deliverParagraphs(
  type: EmailType,
  about: EmailAbout,
  to: string,
  subject: string,
  paragraphs: string[],
): Promise<void> {
  await deliver(type, about, {
    from: env.SMTP_FROM,
    to,
    subject,
    text: paragraphs.join("\n\n"),
    html: paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join(""),
  })
}

export async function sendOrganisationRequestReceivedEmail(
  to: string,
  organisation: { legalName: string },
  about: EmailAbout = {},
): Promise<void> {
  await deliverParagraphs("organisation_request_received", about, to, "Votre demande de compte professionnel", [
    `Nous avons bien reçu la demande de compte professionnel pour ${organisation.legalName}.`,
    "Notre équipe la vérifie et vous écrit dès qu'elle est validée. D'ici là, vous pouvez vous connecter, mais pas encore demander de devis.",
    "À chaque connexion, un code vous sera envoyé par e-mail après votre mot de passe.",
  ])
}

export async function sendOrganisationApprovedEmail(
  to: string,
  organisation: { legalName: string },
  about: EmailAbout = {},
): Promise<void> {
  await deliverParagraphs("organisation_approved", about, to, "Votre compte professionnel est validé", [
    `Le compte professionnel de ${organisation.legalName} est validé.`,
    `Vous pouvez dès maintenant demander vos devis depuis votre espace : ${PRO_SPACE_URL()}`,
  ])
}

export async function sendOrganisationRejectedEmail(
  to: string,
  organisation: { legalName: string; reason: string },
  about: EmailAbout = {},
): Promise<void> {
  await deliverParagraphs("organisation_rejected", about, to, "Votre demande de compte professionnel", [
    `Nous ne pouvons pas valider la demande de compte professionnel pour ${organisation.legalName}.`,
    `Motif : ${organisation.reason}`,
    "Vous pouvez répondre à cet e-mail pour nous apporter des précisions, ou déposer une nouvelle demande.",
  ])
}

export async function sendOrganisationSuspendedEmail(
  to: string,
  organisation: { legalName: string; reason: string },
  about: EmailAbout = {},
): Promise<void> {
  await deliverParagraphs("organisation_suspended", about, to, "Votre compte professionnel est suspendu", [
    `Le compte professionnel de ${organisation.legalName} est suspendu : les demandes de devis ne sont plus possibles.`,
    `Motif : ${organisation.reason}`,
    "Votre historique reste consultable. Répondez à cet e-mail pour en parler avec nous.",
  ])
}

export async function sendOrganisationReinstatedEmail(
  to: string,
  organisation: { legalName: string },
  about: EmailAbout = {},
): Promise<void> {
  await deliverParagraphs("organisation_reinstated", about, to, "Votre compte professionnel est rétabli", [
    `Le compte professionnel de ${organisation.legalName} est rétabli.`,
    `Vous pouvez à nouveau demander vos devis depuis votre espace : ${PRO_SPACE_URL()}`,
  ])
}

/** Story 12.8c — the pro's receipt for a quote request. */
export async function sendQuoteRequestReceivedEmail(
  to: string,
  request: { number: string; lineCount: number },
  about: EmailAbout = {},
): Promise<void> {
  const lines = request.lineCount > 1 ? `${request.lineCount} articles` : "1 article"
  await deliverParagraphs("quote_request_received", about, to, `Demande de devis ${request.number} reçue`, [
    `Nous avons bien reçu votre demande de devis ${request.number} (${lines}).`,
    "Notre équipe l'étudie et vous envoie un devis par e-mail. Vous pouvez suivre son avancement depuis votre espace.",
    `Votre espace : ${PRO_SPACE_URL()}`,
  ])
}

export interface QuoteRequestAlert {
  number: string
  legalName: string
  lineCount: number
}

/** Internal alert to SCS admins: not a customer e-mail, so not journaled (12.7c). */
export async function sendQuoteRequestAlertEmail(to: string[], request: QuoteRequestAlert): Promise<void> {
  if (to.length === 0) return
  const lines = [
    `Nouvelle demande de devis ${request.number} de ${request.legalName} : ${request.lineCount} ligne(s).`,
    `À traiter ici : ${env.WEB_BASE_URL}/admin/devis`,
  ]
  await transporter.sendMail({
    from: env.SMTP_FROM,
    to,
    subject: `[Devis] ${request.number} — ${request.legalName}`,
    text: lines.join("\n\n"),
    html: lines.map((line) => `<p>${escapeHtml(line)}</p>`).join(""),
  })
}

export interface OrganisationRequestAlert {
  legalName: string
  siret: string
  type: OrganisationType
  /** False when the registry could not confirm an open establishment. */
  registryVerified: boolean
}

/** Internal alert to SCS admins: not a customer e-mail, so not journaled (12.7c). */
export async function sendOrganisationRequestAlertEmail(
  to: string[],
  request: OrganisationRequestAlert,
): Promise<void> {
  if (to.length === 0) return
  const reviewUrl = `${env.WEB_BASE_URL}/admin/organisations`
  const lines = [
    `Nouvelle demande de compte professionnel : ${request.legalName} (${ORGANISATION_TYPE_LABELS[request.type]}), SIRET ${request.siret}.`,
    request.registryVerified
      ? "Le registre des entreprises confirme un établissement actif."
      : "Attention : le registre des entreprises n'a pas confirmé un établissement actif.",
    `À valider ici : ${reviewUrl}`,
  ]
  await transporter.sendMail({
    from: env.SMTP_FROM,
    to,
    subject: `[À valider] Compte pro — ${request.legalName}`,
    text: lines.join("\n\n"),
    html: lines.map((line) => `<p>${escapeHtml(line)}</p>`).join(""),
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
  /** Past this, the order is cancelled if nothing was paid (story 12.9a). */
  paymentDueAt: Date
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

export interface TransferReminderEmail {
  orderId: string
  orderRef: string
  firstname: string | null
  amountTtc: number
  reference: string | null
  deadline: Date
}

/**
 * "Your transfer has not arrived" (story 12.9a), day 4 of the week an order with
 * a bank transfer is held. Sent once (`orders.payment_reminder_sent_at`).
 */
export async function sendTransferReminderEmail(to: string, r: TransferReminderEmail): Promise<void> {
  const orderUrl = `${env.WEB_BASE_URL}/commande/${r.orderId}`
  await deliverParagraphs(
    "transfer_reminder",
    { orderId: r.orderId },
    to,
    `Votre virement pour la commande ${r.orderRef}`,
    [
      r.firstname ? `Bonjour ${r.firstname},` : "Bonjour,",
      `Nous n'avons pas encore reçu votre virement de ${EUROS.format(r.amountTtc)} pour la commande ${r.orderRef}${r.reference ? ` (référence à indiquer : ${r.reference})` : ""}.`,
      `Vos articles restent réservés jusqu'au ${PARIS_DATETIME.format(r.deadline)}. Sans paiement à cette date, la commande sera annulée et les articles remis en vente.`,
      `Les coordonnées bancaires figurent sur la page de votre commande : ${orderUrl}`,
      "Si vous avez déjà fait le virement, signalez-le depuis cette page : nous le rapprocherons dès son arrivée.",
    ],
  )
}

export interface UnpaidOrderCancelledEmail {
  orderId: string
  orderRef: string
  firstname: string | null
}

/** "Your order was cancelled for lack of payment" (story 12.9a). Nothing was charged. */
export async function sendUnpaidOrderCancelledEmail(to: string, c: UnpaidOrderCancelledEmail): Promise<void> {
  await deliverParagraphs("unpaid_order_cancelled", { orderId: c.orderId }, to, `Commande ${c.orderRef} annulée`, [
    c.firstname ? `Bonjour ${c.firstname},` : "Bonjour,",
    `Faute de paiement dans le délai prévu par nos conditions générales de vente, votre commande ${c.orderRef} est annulée et ses articles sont remis en vente. Aucune somme ne vous a été prélevée.`,
    `Vous pouvez repasser commande à tout moment sur ${env.WEB_BASE_URL}.`,
  ])
}

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
  if (o.cardTtc > 0 || o.transferTtc > 0) {
    steps.push(
      `Réglez votre commande avant le ${PARIS_DATETIME.format(o.paymentDueAt)} : passé ce délai, elle est annulée et ses articles remis en vente.`,
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
