import {
  collectLeaves,
  splitLeaf,
  type SplitDirection,
  type SplitNode,
} from '@/components/terminal/splitTree'

export type SplitLayoutLeaf = { kind: 'leaf'; role: number }
export type SplitLayoutBranch = {
  kind: 'branch'
  direction: SplitDirection
  ratio: number
  first: SplitLayoutNode
  second: SplitLayoutNode
}
export type SplitLayoutNode = SplitLayoutLeaf | SplitLayoutBranch

export interface SplitLayoutSnapshot {
  tree: SplitLayoutNode
  /** Ordered leaf terminal roles; role 0 is always the tab primary pane. */
  paneCount: number
}

export function serializeSplitLayout(tree: SplitNode, primaryID: string): SplitLayoutSnapshot | null {
  const leaves = collectLeaves(tree)
  if (leaves.length <= 1) return null
  const roles = new Map<string, number>()
  // Ensure primary is role 0 when present.
  const ordered = [...leaves]
  const primaryIndex = ordered.findIndex((leaf) => leaf.terminalID === primaryID)
  if (primaryIndex > 0) {
    const [primary] = ordered.splice(primaryIndex, 1)
    ordered.unshift(primary)
  }
  ordered.forEach((leaf, index) => roles.set(leaf.terminalID, index))
  return {
    paneCount: ordered.length,
    tree: mapTreeToRoles(tree, roles),
  }
}

function mapTreeToRoles(node: SplitNode, roles: Map<string, number>): SplitLayoutNode {
  if (node.kind === 'leaf') {
    return { kind: 'leaf', role: roles.get(node.terminalID) ?? 0 }
  }
  return {
    kind: 'branch',
    direction: node.direction,
    ratio: node.ratio,
    first: mapTreeToRoles(node.first, roles),
    second: mapTreeToRoles(node.second, roles),
  }
}

export function materializeSplitLayout(layout: SplitLayoutSnapshot, terminalIDs: string[]): SplitNode | null {
  if (!layout || layout.paneCount < 2) return null
  if (terminalIDs.length < layout.paneCount) return null
  try {
    return mapRolesToTree(layout.tree, terminalIDs)
  } catch {
    return null
  }
}

function mapRolesToTree(node: SplitLayoutNode, terminalIDs: string[]): SplitNode {
  if (node.kind === 'leaf') {
    const terminalID = terminalIDs[node.role]
    if (!terminalID) throw new Error('missing role')
    return splitLeaf(terminalID)
  }
  return {
    kind: 'branch',
    id: crypto.randomUUID(),
    direction: node.direction,
    ratio: Math.min(85, Math.max(15, node.ratio)),
    first: mapRolesToTree(node.first, terminalIDs),
    second: mapRolesToTree(node.second, terminalIDs),
  }
}

export function isSplitLayoutSnapshot(value: unknown): value is SplitLayoutSnapshot {
  if (!isRecord(value) || !Number.isSafeInteger(value.paneCount) || Number(value.paneCount) < 2) return false
  if (Number(value.paneCount) > 8) return false
  return isSplitLayoutNode(value.tree, Number(value.paneCount))
}

function isSplitLayoutNode(value: unknown, paneCount: number): value is SplitLayoutNode {
  if (!isRecord(value)) return false
  if (value.kind === 'leaf') {
    return Number.isSafeInteger(value.role) && Number(value.role) >= 0 && Number(value.role) < paneCount
  }
  if (value.kind !== 'branch') return false
  if (value.direction !== 'horizontal' && value.direction !== 'vertical') return false
  if (typeof value.ratio !== 'number' || !Number.isFinite(value.ratio)) return false
  return isSplitLayoutNode(value.first, paneCount) && isSplitLayoutNode(value.second, paneCount)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
