import { describe, expect, it } from "vitest"
import { placementIssue, type TreeNode } from "./tree.js"

const node = (id: string, parentId: string | null, kind = "filter"): TreeNode => ({ id, parentId, kind })

// Story 12.15b — the tree rules, on rows already loaded.
describe("placementIssue", () => {
  const tree = [node("a", null), node("b", "a"), node("c", "b"), node("l", null, "link")]

  it("takes a place within three levels", () => {
    expect(placementIssue(tree, null, null)).toBeNull()
    expect(placementIssue(tree, null, "b")).toBeNull()
  })

  it("refuses a fourth level, a link as parent and the entry's own branch", () => {
    expect(placementIssue(tree, null, "c")).toMatch(/levels/)
    expect(placementIssue(tree, null, "l")).toMatch(/link/)
    expect(placementIssue(tree, "a", "c")).toMatch(/own branch/)
  })

  // Should a cycle ever reach the table, the walk stops instead of hanging the API.
  it("stops on a cycle already in the rows", () => {
    const looped = [node("x", "y"), node("y", "x")]
    expect(() => placementIssue(looped, null, "x")).toThrow(/cycle/)
  })
})
