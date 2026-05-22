import { seedDatabase } from "./seeds.js"

try {
  await seedDatabase()
  console.info("✅ Seed complete")
  process.exit(0)
} catch (err) {
  console.error("❌ Seed failed:", err)
  process.exit(1)
}
