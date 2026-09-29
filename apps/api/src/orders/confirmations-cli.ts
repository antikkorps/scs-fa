import { resendPendingConfirmations } from "./confirmation.js"

// Single-shot order confirmation retry pass for external schedulers (system/container cron).
try {
  const r = await resendPendingConfirmations(console)
  console.info(`✅ Order confirmations: ${r.pending} pending, ${r.sent} sent`)
  process.exit(0)
} catch (err) {
  console.error("❌ Order confirmation retry failed:", err)
  process.exit(1)
}
