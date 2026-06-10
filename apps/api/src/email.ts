import type { LegalDocRejectionReason, LegalDocType } from "@armurier/shared"
import { createTransport } from "nodemailer"
import { env } from "./env.js"

const transporter = createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
})

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const resetUrl = `https://armurier.fr/reset-password?token=${token}`

  await transporter.sendMail({
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

/** Escape free-text values interpolated into HTML email bodies. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
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

export async function sendLegalDocApprovedEmail(to: string, doc: { docType: LegalDocType }): Promise<void> {
  const label = DOC_TYPE_LABELS[doc.docType]
  await transporter.sendMail({
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

  const queueUrl = "https://armurier.fr/admin/legal-documents"
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

export async function sendLegalDocRejectedEmail(
  to: string,
  doc: { docType: LegalDocType; reason: LegalDocRejectionReason; notes?: string | null },
): Promise<void> {
  const label = DOC_TYPE_LABELS[doc.docType]
  const reasonLabel = REJECTION_REASON_LABELS[doc.reason]
  const notesText = doc.notes ? `\n\nDetails: ${doc.notes}` : ""
  await transporter.sendMail({
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
