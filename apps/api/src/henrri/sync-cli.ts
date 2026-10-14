import { henrriClientFromEnv, processPendingHenrriDocuments } from "./queue.js"

// Single-shot Henrri queue pass for external schedulers (system/container cron).
const client = henrriClientFromEnv()
if (!client) {
  console.error("❌ Henrri is not configured: set HENRRI_BASE_URL, HENRRI_CLIENT_ID and HENRRI_CLIENT_SECRET")
  process.exit(1)
}

try {
  const result = await processPendingHenrriDocuments(client, console)
  console.info(
    `✅ Henrri sync: ${result.queued} queued, ${result.finalized} done, ${result.retry} to retry, ${result.blocked} blocked, ${result.waiting} waiting`,
  )
  process.exit(0)
} catch (err) {
  console.error("❌ Henrri sync failed:", err)
  process.exit(1)
}
