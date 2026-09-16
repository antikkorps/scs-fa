import { runShipmentTrackingSync } from "./sync.js"

// Single-shot carrier tracking sync for external schedulers (system/container cron).
try {
  const r = await runShipmentTrackingSync(console)
  console.info(`✅ Tracking sync: ${r.checked} checked, ${r.delivered} delivered, ${r.failed} failed`)
  process.exit(0)
} catch (err) {
  console.error("❌ Tracking sync failed:", err)
  process.exit(1)
}
