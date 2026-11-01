import { backfillOgImages } from "./service.js"

// One-off: `pnpm --filter @armurier/api media:backfill-og`.
// Safe to re-run — media that already have their share card are skipped.
try {
  const { created, skipped, failed } = await backfillOgImages()
  console.info(`✅ Share-card backfill: ${created} created, ${skipped} already present, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
} catch (err) {
  console.error("❌ Share-card backfill failed:", err)
  process.exit(1)
}
