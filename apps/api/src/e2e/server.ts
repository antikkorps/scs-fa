import { buildApp } from "../app.js"
import { seedDemoData, seedReferenceData } from "../db/seeds.js"
import { env } from "../env.js"
import { assertE2eEnvironment, seedE2eFixtures } from "./fixtures.js"

// The API the layout checks run against: `pnpm --filter @armurier/api e2e:server`.
//
// Seeding and serving happen in ONE process on purpose: images live in memory
// (STORAGE_DRIVER=memory), so fixtures seeded by a separate command would lose
// their bytes before the server ever started.
assertE2eEnvironment(env)

await seedReferenceData()
await seedDemoData()
await seedE2eFixtures()

const fastify = await buildApp()
try {
  await fastify.listen({ host: env.API_HOST, port: env.API_PORT })
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
