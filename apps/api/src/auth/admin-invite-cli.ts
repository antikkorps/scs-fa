import { ADMIN_INVITATION_TTL_HOURS, inviteAdmin, NotAnAdminError } from "./admin-invite.js"

// Decision 2026-11-04 — `pnpm auth:admin-invite <email> <prénom> <nom>` (on the
// server: `just admin-invite …`): creates an admin without a password and sends
// them a single-use link to choose one. The link is printed too, to pass on
// another way (Signal, by phone) if the e-mail does not arrive. Running it again
// for the same admin sends a new link; the previous one stops working.
const [email, firstname, ...lastnameWords] = process.argv.slice(2)
const lastname = lastnameWords.join(" ")
if (!email || !firstname || !lastname) {
  console.error("Usage: pnpm auth:admin-invite <email> <prénom> <nom>")
  process.exit(1)
}

try {
  const invitation = await inviteAdmin({ email, firstname, lastname })
  console.info(
    invitation.created
      ? `✅ Administrateur créé : ${invitation.email}`
      : `✅ Nouvelle invitation pour ${invitation.email} : le lien précédent ne fonctionne plus`,
  )
  console.info(
    invitation.emailSent
      ? "   L'invitation est partie par e-mail."
      : "⚠️  L'e-mail n'a pas pu partir : transmettez le lien ci-dessous par un autre moyen.",
  )
  console.info(`   Lien (usage unique, valable ${ADMIN_INVITATION_TTL_HOURS} h) :\n   ${invitation.link}`)
  process.exit(0)
} catch (error) {
  if (error instanceof NotAnAdminError) {
    console.error(
      `❌ ${email.trim().toLowerCase()} n'est pas un compte administrateur : une invitation ne change jamais un rôle.`,
    )
  } else {
    console.error("❌ Invitation impossible :", error instanceof Error ? error.message : error)
  }
  process.exit(1)
}
