import { describe, expect, it, vi } from "vitest"
import { db } from "./client.js"
import { insertEntries } from "./seed-menu.js"

// Story 12.15b — the initial menu on a server where a reference went missing.
describe("insertEntries", () => {
  it("skips an entry naming a missing category, with its branch, and lays the rest", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    let count = -1
    // Rolled back: the shared test database keeps its own menu.
    await expect(
      db.transaction(async (tx) => {
        count = await insertEntries(
          [
            { slug: "testseed-ko", label: "Ko", category: "inexistante", children: [{ slug: "x", label: "X" }] },
            { slug: "testseed-ok", label: "Ok", children: [{ slug: "y", label: "Y" }] },
          ],
          null,
          tx,
        )
        throw new Error("rollback")
      }),
    ).rejects.toThrow("rollback")
    expect(count).toBe(2)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("testseed-ko"))
    warn.mockRestore()
  })
})
