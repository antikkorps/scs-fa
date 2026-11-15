import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

// The whole production .env, as the one-off env-check service receives it:
// the API itself no longer sees the Postgres, backup and Umami secrets.
const TSX = resolve("node_modules/.bin/tsx")
const CLI = resolve("src/env-check-cli.ts")

const REAL = {
  JWT_SECRET: "q8Zr2vK1fLw9Xs0PmB4tY7nH3cJ6gD5aE1uR8iO2pQ9w",
  JWT_REFRESH_SECRET: "Lm3Nb8Vc1Xz7Qw4Er9Ty2Ui6Op0As5Df3Gh8Jk1Lz4x",
  POSTGRES_PASSWORD: "b7e1c94f20a35d68",
}

function check(environment: Record<string, string>) {
  const result = spawnSync(TSX, [CLI], {
    env: { PATH: process.env.PATH ?? "", ...environment },
    encoding: "utf8",
  })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

describe("env-check CLI (whole production .env)", () => {
  it("passes real values", () => {
    expect(check(REAL).status).toBe(0)
  }, 30_000)

  it("refuses a sample secret of another service, naming it without its value", () => {
    const { status, output } = check({ ...REAL, UMAMI_APP_SECRET: "CHANGE-ME-openssl-rand-hex-32" })
    expect(status).not.toBe(0)
    expect(output).toContain("UMAMI_APP_SECRET")
    expect(output).not.toContain("openssl-rand")
  }, 30_000)
})
