import { env } from "../env.js"
import { HenrriError, henrriClientFromConfig } from "./client.js"

// Read-only Henrri connectivity check (story 12.6): authenticates and resolves the
// invoice and credit-note types. Creates nothing and spends no credit. Prints no
// credential, only what Henrri answered.
const client = henrriClientFromConfig({
  baseUrl: env.HENRRI_BASE_URL,
  clientId: env.HENRRI_CLIENT_ID,
  clientSecret: env.HENRRI_CLIENT_SECRET,
})
if (!client) {
  console.error("❌ Henrri is not configured: set HENRRI_BASE_URL, HENRRI_CLIENT_ID and HENRRI_CLIENT_SECRET")
  process.exit(1)
}

try {
  const invoiceTypeId = await client.documentTypeId("invoice")
  const creditNoteTypeId = await client.documentTypeId("creditNote")
  console.info(
    `✅ Henrri reachable at ${env.HENRRI_BASE_URL}: invoice type ${invoiceTypeId}, credit note type ${creditNoteTypeId}`,
  )
  process.exit(0)
} catch (err) {
  const detail = err instanceof HenrriError ? `${err.code} (${err.status ?? "no answer"})` : String(err)
  console.error(`❌ Henrri check failed: ${detail}`)
  process.exit(1)
}
