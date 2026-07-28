import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readStorageItem, readStorageNumber, removeStorageItem, writeStorageItem } from '@/lib/safeStorage'

describe('safeStorage', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('reads, writes, and removes values', () => {
    expect(writeStorageItem('key', 'value')).toBe(true)
    expect(readStorageItem('key')).toBe('value')
    expect(removeStorageItem('key')).toBe(true)
    expect(readStorageItem('key')).toBeNull()
  })

  it('returns null when storage reads fail', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })

    expect(readStorageItem('key')).toBeNull()
  })

  it('returns false when storage writes fail', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })

    expect(writeStorageItem('key', 'value')).toBe(false)
  })

  it('returns false when storage removals fail', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })

    expect(removeStorageItem('key')).toBe(false)
  })

  it.each(['', 'not-a-number', 'Infinity'])('uses the fallback for invalid number %j', (value) => {
    localStorage.setItem('width', value)

    expect(readStorageNumber('width', 420)).toBe(420)
  })

  it('returns finite stored numbers', () => {
    localStorage.setItem('width', '512')

    expect(readStorageNumber('width', 420)).toBe(512)
  })
})
