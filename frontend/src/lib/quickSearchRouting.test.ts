import { describe, expect, it } from 'vitest'
import { resolveQuickSearchTarget } from '@/lib/quickSearchRouting'

describe('resolveQuickSearchTarget', () => {
  it('routes terminal surfaces to in-terminal search', () => {
    expect(resolveQuickSearchTarget({ type: 'terminal', id: 'terminal-1' })).toBe('terminal-search')
  })

  it('routes non-terminal surfaces to session quick search', () => {
    expect(resolveQuickSearchTarget({ type: 'workspace', id: 'sessions' })).toBe('session-search')
    expect(resolveQuickSearchTarget(null)).toBe('session-search')
  })
})
