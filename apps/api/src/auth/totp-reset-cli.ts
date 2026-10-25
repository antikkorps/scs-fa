import { resetSecondFactorByEmail } from "./two-factor.js"

// Story 12.8e — `pnpm auth:totp-reset <email>`: clears an account's
// authenticator app when no admin can do it from the back-office (the only
// admin lost their phone and their recovery codes). Run on the server.
const email = process.argv[2]
if (!email) {
  console.error("Usage: pnpm auth:totp-reset <email>")
  process.exit(1)
}

if (await resetSecondFactorByEmail(email)) {
  console.info(`✅ Authenticator app reset for ${email}: it enrols again at the next login.`)
  process.exit(0)
}
console.error(`❌ No account for ${email}`)
process.exit(1)
