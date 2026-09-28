import { processCatalogImageBatch } from "./images.js"

// Resume the image queue of the catalogue import (story 12.2) by hand — after a
// restart, or to drain it outside the API process.
try {
  let total = { done: 0, failed: 0 }
  for (;;) {
    const batch = await processCatalogImageBatch()
    if (batch.claimed === 0) break
    total = { done: total.done + batch.done, failed: total.failed + batch.failed }
    console.info(`… ${total.done} downloaded, ${total.failed} failed`)
  }
  console.info(`✅ Catalogue images: ${total.done} downloaded, ${total.failed} failed`)
  process.exit(0)
} catch (err) {
  console.error("❌ Catalogue image queue failed:", err)
  process.exit(1)
}
