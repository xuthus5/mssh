import { describe, expect, it } from 'vitest'
import { insertSplit, splitLeaf, terminalIDs } from '@/components/terminal/splitTree'
import {
  isSplitLayoutSnapshot,
  materializeSplitLayout,
  serializeSplitLayout,
} from '@/components/terminal/splitLayout'

describe('splitLayout', () => {
  it('serializes multi-pane trees without raw terminal IDs', () => {
    const first = insertSplit(splitLeaf('primary'), 'primary', 'second', 'horizontal', 'branch-1')
    const nested = insertSplit(first, 'second', 'third', 'vertical', 'branch-2')
    const snapshot = serializeSplitLayout(nested, 'primary')
    expect(snapshot?.paneCount).toBe(3)
    const raw = JSON.stringify(snapshot)
    expect(raw).not.toContain('primary')
    expect(raw).not.toContain('"third"')
    expect(raw).not.toMatch(/"role":\s*"[a-z]/)
    expect(isSplitLayoutSnapshot(snapshot)).toBe(true)
  })

  it('materializes roles back into a terminal tree', () => {
    const tree = insertSplit(splitLeaf('a'), 'a', 'b', 'horizontal', 'branch-1')
    const snapshot = serializeSplitLayout(tree, 'a')
    requireDefined(snapshot)
    const restored = materializeSplitLayout(snapshot, ['x', 'y'])
    requireDefined(restored)
    expect(terminalIDs(restored)).toEqual(['x', 'y'])
    expect(restored).toMatchObject({ kind: 'branch', direction: 'horizontal' })
  })

  it('rejects incomplete terminal id lists', () => {
    const tree = insertSplit(splitLeaf('a'), 'a', 'b', 'vertical', 'b1')
    const snapshot = serializeSplitLayout(tree, 'a')
    requireDefined(snapshot)
    expect(materializeSplitLayout(snapshot, ['only-one'])).toBeNull()
  })
})

function requireDefined<T>(value: T | null | undefined): asserts value is T {
  expect(value).toBeTruthy()
}
