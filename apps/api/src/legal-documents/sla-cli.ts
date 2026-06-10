import { runLegalDocSlaBreachCheck } from "./sla.js"

// Single-shot SLA breach check for external schedulers (system/container cron).
try {
  const r = await runLegalDocSlaBreachCheck()
  console.info(`✅ SLA breach check: ${r.breached} breached, notified=${r.notified}`)
  process.exit(0)
} catch (err) {
  console.error("❌ SLA breach check failed:", err)
  process.exit(1)
}
