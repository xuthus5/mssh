import { describe, expect, it } from 'vitest'
import { hasTerminal, insertSplit, removeTerminal, replaceTerminal, splitLeaf, terminalIDs, updateSplitRatio } from '@/components/terminal/splitTree'

describe('splitTree', () => {
  it('recursively splits the selected terminal', () => {
    const first = insertSplit(splitLeaf('primary'), 'primary', 'second', 'horizontal', 'branch-1')
    const nested = insertSplit(first, 'second', 'third', 'vertical', 'branch-2')

    expect(terminalIDs(nested)).toEqual(['primary', 'second', 'third'])
    expect(nested).toMatchObject({
      kind: 'branch', direction: 'horizontal', second: { kind: 'branch', direction: 'vertical' },
    })
  })

  it('collapses the parent and focuses the most recent sibling leaf', () => {
    const first = insertSplit(splitLeaf('primary'), 'primary', 'second', 'horizontal', 'branch-1')
    const nested = insertSplit(first, 'second', 'third', 'vertical', 'branch-2')
    const result = removeTerminal(nested, 'second', (id) => id === 'third' ? 20 : 10)

    expect(result?.focusID).toBe('third')
    expect(result && terminalIDs(result.node)).toEqual(['primary', 'third'])
  })

  it('replaces terminal IDs and clamps divider ratios', () => {
    const tree = insertSplit(splitLeaf('primary'), 'primary', 'second', 'horizontal', 'branch-1')
    const originalLeaf = tree.kind === 'branch' && tree.first.kind === 'leaf' ? tree.first : null
    const replaced = replaceTerminal(tree, 'primary', 'reconnected')
    const replacedLeaf = replaced.kind === 'branch' && replaced.first.kind === 'leaf' ? replaced.first : null

    expect(originalLeaf?.id).toBeTruthy()
    expect(replacedLeaf?.id).toBe(originalLeaf?.id)
    expect(hasTerminal(replaced, 'primary')).toBe(false)
    expect(terminalIDs(replaced)).toEqual(['reconnected', 'second'])
    expect(updateSplitRatio(replaced, 'branch-1', 2)).toMatchObject({ ratio: 15 })
    expect(updateSplitRatio(replaced, 'branch-1', 99)).toMatchObject({ ratio: 85 })
  })
})
