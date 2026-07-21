import { describe, expect, it } from 'vitest'
import { computeVirtualWindow } from '@/lib/virtualWindow'

describe('computeVirtualWindow', () => {
  it('returns only the visible window plus overscan for large lists', () => {
    const result = computeVirtualWindow({ count: 1000, estimateSize: 32, scrollOffset: 3200, viewportSize: 320, overscan: 4 })
    expect(result.totalSize).toBe(32000)
    expect(result.items.length).toBeLessThan(30)
    expect(result.items[0].index).toBeGreaterThan(90)
  })
})
