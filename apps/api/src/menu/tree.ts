// Story 12.15b — the shape rules of the menu tree, on rows already loaded:
// the menu holds a few dozen entries, so the whole tree is read at once.

import { MENU_MAX_DEPTH } from "@armurier/shared"

export interface TreeNode {
  id: string
  parentId: string | null
  kind: string
}

/**
 * The entry, its parent, and so on to the top. Throws on a cycle rather than
 * loop: the writes are serialised (see lockMenu), but a walk that never ends
 * would hang the whole API.
 */
function ancestry(id: string, byId: Map<string, TreeNode>): TreeNode[] {
  const chain: TreeNode[] = []
  for (let node = byId.get(id); node; node = node.parentId ? byId.get(node.parentId) : undefined) {
    if (chain.includes(node)) throw new Error(`Menu cycle through entry ${node.id}`)
    chain.push(node)
  }
  return chain
}

/** Levels the entry's branch spans, itself included. */
function branchHeight(id: string, nodes: TreeNode[]): number {
  const children = nodes.filter((node) => node.parentId === id)
  return 1 + Math.max(0, ...children.map((child) => branchHeight(child.id, nodes)))
}

/**
 * Why an entry (new: `id` null) cannot sit under `parentId`, or null. A moved
 * entry brings its branch along, so the branch's height counts.
 */
export function placementIssue(nodes: TreeNode[], id: string | null, parentId: string | null): string | null {
  if (parentId === null) return null
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const parent = byId.get(parentId)
  if (!parent) return "Unknown parent entry"
  if (parent.kind === "link") return "A link entry has no children"
  const parentChain = ancestry(parentId, byId)
  if (id !== null && parentChain.some((node) => node.id === id)) return "An entry cannot move under its own branch"
  const height = id === null ? 1 : branchHeight(id, nodes)
  if (parentChain.length + height > MENU_MAX_DEPTH) return `The menu has ${MENU_MAX_DEPTH} levels at most`
  return null
}
