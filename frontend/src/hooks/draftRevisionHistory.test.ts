import { describe, expect, it } from 'vitest'
import { DraftRevisionHistory, draftRevisionFingerprint } from '@/hooks/draftRevisionHistory'

describe('DraftRevisionHistory', () => {
  it('keeps the newest revision for a repeated draft value', () => {
    const history = new DraftRevisionHistory(2)

    history.record('same-draft', 1)
    history.record('same-draft', 3)
    history.record('same-draft', 2)

    expect(history.get('same-draft')).toBe(3)
    expect(history.size).toBe(1)
  })

  it('evicts the least recently used draft fingerprint', () => {
    const history = new DraftRevisionHistory(2)
    history.record('first', 1)
    history.record('second', 2)
    expect(history.get('first')).toBe(1)

    history.record('third', 3)

    expect(history.get('second')).toBeUndefined()
    expect(history.get('first')).toBe(1)
    expect(history.get('third')).toBe(3)
    expect(history.size).toBe(2)
  })

  it('uses a stable fingerprint instead of retaining the serialized draft', () => {
    const serialized = JSON.stringify({ proxyPassword: 'sensitive-value' })

    const fingerprint = draftRevisionFingerprint(serialized)

    expect(fingerprint).toBe(draftRevisionFingerprint(serialized))
    expect(fingerprint).not.toContain('sensitive-value')
    expect(fingerprint).not.toBe(serialized)
  })

  it('rejects a non-positive history limit', () => {
    expect(() => new DraftRevisionHistory(0)).toThrow('history limit must be positive')
  })
})
