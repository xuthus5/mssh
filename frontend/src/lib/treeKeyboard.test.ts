import { describe, expect, it } from 'vitest'
import { nextTreeIndex } from '@/lib/treeKeyboard'

describe('nextTreeIndex', () => {
  it('moves within bounds for arrow and home/end keys', () => {
    expect(nextTreeIndex(0, 'ArrowDown', 5)).toBe(1)
    expect(nextTreeIndex(4, 'ArrowDown', 5)).toBe(4)
    expect(nextTreeIndex(2, 'Home', 5)).toBe(0)
    expect(nextTreeIndex(2, 'End', 5)).toBe(4)
  })
})
