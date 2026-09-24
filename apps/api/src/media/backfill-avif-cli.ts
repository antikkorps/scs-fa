import { backfillAvifRenditions } from "./service.js"

// One-off (story 9.6): `pnpm --filter @armurier/api media:backfill-avif`.
// Safe to re-run — renditions already in AVIF are skipped.
try {
  const { created, skipped, failed } = await backfillAvifRenditions()
  console.info(`✅ AVIF backfill: ${created} created, ${skipped} already present, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
} catch (err) {
  console.error("❌ AVIF backfill failed:", err)
  process.exit(1)
}
