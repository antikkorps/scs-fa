// Story 12.9b, audit 2026-11-15 — the API only receives its own variables, so
// its startup check no longer sees the Postgres, backup and Umami secrets of the
// shared production .env. This one-off check (`env-check` compose service, run
// first by `just deploy` / `just update`) reads the whole file and refuses the
// committed examples' sample values. Names only, never a value.
import { sampleValueProblems } from "./env-guard.js"

const problems = sampleValueProblems(process.env)
if (problems.length > 0) {
  console.error(`.env still holds sample values. Set a real value for: ${problems.join(", ")}`)
  process.exit(1)
}
console.log(".env: no sample value left")
