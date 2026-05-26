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
