export type SplitDirection = 'horizontal' | 'vertical'

export interface SplitLeaf {
  kind: 'leaf'
  terminalID: string
}

export interface SplitBranch {
  kind: 'branch'
  id: string
  direction: SplitDirection
  ratio: number
  first: SplitNode
  second: SplitNode
}

export type SplitNode = SplitLeaf | SplitBranch

export const splitLeaf = (terminalID: string): SplitLeaf => ({ kind: 'leaf', terminalID })

export function terminalIDs(node: SplitNode): string[] {
  return node.kind === 'leaf' ? [node.terminalID] : [...terminalIDs(node.first), ...terminalIDs(node.second)]
}

export function hasTerminal(node: SplitNode, terminalID: string): boolean {
  return node.kind === 'leaf'
    ? node.terminalID === terminalID
    : hasTerminal(node.first, terminalID) || hasTerminal(node.second, terminalID)
}

export function insertSplit(node: SplitNode, targetID: string, terminalID: string, direction: SplitDirection, branchID: string): SplitNode {
  if (node.kind === 'leaf') {
    if (node.terminalID !== targetID) return node
    return { kind: 'branch', id: branchID, direction, ratio: 50, first: node, second: splitLeaf(terminalID) }
  }
  const first = insertSplit(node.first, targetID, terminalID, direction, branchID)
  if (first !== node.first) return { ...node, first }
  const second = insertSplit(node.second, targetID, terminalID, direction, branchID)
  return second === node.second ? node : { ...node, second }
}

export function replaceTerminal(node: SplitNode, previousID: string, nextID: string): SplitNode {
  if (node.kind === 'leaf') return node.terminalID === previousID ? splitLeaf(nextID) : node
  const first = replaceTerminal(node.first, previousID, nextID)
  const second = replaceTerminal(node.second, previousID, nextID)
  return first === node.first && second === node.second ? node : { ...node, first, second }
}

export function updateSplitRatio(node: SplitNode, branchID: string, ratio: number): SplitNode {
  if (node.kind === 'leaf') return node
  if (node.id === branchID) return { ...node, ratio: Math.min(85, Math.max(15, ratio)) }
  const first = updateSplitRatio(node.first, branchID, ratio)
  const second = updateSplitRatio(node.second, branchID, ratio)
  return first === node.first && second === node.second ? node : { ...node, first, second }
}

export function mostRecentTerminal(node: SplitNode, lastUsed: (terminalID: string) => number): string {
  return terminalIDs(node).reduce((selected, terminalID) => (
    lastUsed(terminalID) > lastUsed(selected) ? terminalID : selected
  ))
}

export interface RemoveTerminalResult {
  node: SplitNode
  focusID: string
}

export function removeTerminal(node: SplitNode, terminalID: string, lastUsed: (terminalID: string) => number): RemoveTerminalResult | null {
  if (node.kind === 'leaf') return null
  if (node.first.kind === 'leaf' && node.first.terminalID === terminalID) {
    return { node: node.second, focusID: mostRecentTerminal(node.second, lastUsed) }
  }
  if (node.second.kind === 'leaf' && node.second.terminalID === terminalID) {
    return { node: node.first, focusID: mostRecentTerminal(node.first, lastUsed) }
  }
  const first = removeTerminal(node.first, terminalID, lastUsed)
  if (first) return { node: { ...node, first: first.node }, focusID: first.focusID }
  const second = removeTerminal(node.second, terminalID, lastUsed)
  return second ? { node: { ...node, second: second.node }, focusID: second.focusID } : null
}
