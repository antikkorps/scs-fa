import { describe, expect, it } from "vitest"
import type { Env } from "../env.js"
import { buildLoggerOptions, genReqId, REDACT_PATHS, resolveLogLevel } from "./logger.js"

function makeEnv(overrides: Partial<Env>): Env {
  return { NODE_ENV: "development", ...overrides } as Env
}

describe("resolveLogLevel", () => {
  it("is silent under tests, info in prod, debug locally", () => {
    expect(resolveLogLevel(makeEnv({ NODE_ENV: "test" }))).toBe("silent")
    expect(resolveLogLevel(makeEnv({ NODE_ENV: "production" }))).toBe("info")
    expect(resolveLogLevel(makeEnv({ NODE_ENV: "development" }))).toBe("debug")
  })

  it("honours an explicit LOG_LEVEL override regardless of env", () => {
    expect(resolveLogLevel(makeEnv({ NODE_ENV: "production", LOG_LEVEL: "warn" }))).toBe("warn")
    expect(resolveLogLevel(makeEnv({ NODE_ENV: "test", LOG_LEVEL: "trace" }))).toBe("trace")
  })
})

describe("buildLoggerOptions", () => {
  it("redacts credentials and sensitive headers", () => {
    const { redact } = buildLoggerOptions(makeEnv({ NODE_ENV: "production" }))
    const paths = (redact as { paths: string[] }).paths
    expect(paths).toEqual([...REDACT_PATHS])
    expect(paths).toContain("req.headers.authorization")
    expect(paths).toContain("req.headers.cookie")
    expect(paths).toContain("*.password")
    expect((redact as { censor: string }).censor).toBe("[redacted]")
  })

  it("tags every record with the service and environment", () => {
    expect(buildLoggerOptions(makeEnv({ NODE_ENV: "production" })).base).toEqual({
      service: "scs-api",
      env: "production",
    })
  })

  it("pretty-prints only in development", () => {
    expect(buildLoggerOptions(makeEnv({ NODE_ENV: "development" })).transport).toMatchObject({ target: "pino-pretty" })
    expect(buildLoggerOptions(makeEnv({ NODE_ENV: "production" })).transport).toBeUndefined()
    expect(buildLoggerOptions(makeEnv({ NODE_ENV: "test" })).transport).toBeUndefined()
  })
})

describe("genReqId", () => {
  const raw = (headers: Record<string, string | string[] | undefined>) => ({ headers }) as never

  it("honours an inbound x-request-id", () => {
    expect(genReqId(raw({ "x-request-id": "trace-abc" }))).toBe("trace-abc")
    expect(genReqId(raw({ "x-request-id": ["trace-first", "trace-second"] }))).toBe("trace-first")
  })

  it("caps a hostile request id length", () => {
    expect(genReqId(raw({ "x-request-id": "x".repeat(500) }))).toHaveLength(200)
  })

  it("mints a UUID when none is provided", () => {
    const id = genReqId(raw({}))
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(genReqId(raw({}))).not.toBe(id) // unique each call
  })
})
