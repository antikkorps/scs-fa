import type { FastifyBaseLogger } from "fastify"
import { drainCatalogImages } from "./images.js"

// Resume the image queue of the catalogue import (story 12.2) by hand — after a
// restart, or to drain it outside the API process. Same loop as the in-process
// drain, scheduled retries included.
const log = {
  info: (obj: object, msg: string) => console.info(`✅ ${msg}`, obj),
  error: (obj: object, msg: string) => console.error(`❌ ${msg}`, obj),
} as unknown as FastifyBaseLogger

await drainCatalogImages(log)
process.exit(0)
