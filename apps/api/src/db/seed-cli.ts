import { seedDemoData, seedReferenceData } from "./seeds.js"

// `tsx src/db/seed-cli.ts`        → reference data only (deployment)
// `tsx src/db/seed-cli.ts --demo` → reference data plus the demo catalogue
const withDemo = process.argv.slice(2).includes("--demo")

try {
  await seedReferenceData()
  if (withDemo) await seedDemoData()
  console.info("✅ Seed complete")
  process.exit(0)
} catch (err) {
  console.error("❌ Seed failed:", err)
  process.exit(1)
}
