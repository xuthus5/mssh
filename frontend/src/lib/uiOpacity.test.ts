import { beforeEach, describe, expect, it } from 'vitest'
import { applyWindowOpacity, clampWindowOpacity } from '@/lib/uiOpacity'

describe('uiOpacity', () => {
  beforeEach(() => document.documentElement.style.removeProperty('--app-opacity'))

  it('clamps opacity to the supported range', () => {
    expect(clampWindowOpacity(40)).toBe(50)
    expect(clampWindowOpacity(75.4)).toBe(75)
    expect(clampWindowOpacity(120)).toBe(100)
    expect(clampWindowOpacity(Number.NaN)).toBe(100)
  })

  it('applies opacity as a CSS variable', () => {
    applyWindowOpacity(82)
    expect(document.documentElement.style.getPropertyValue('--app-opacity')).toBe('0.82')
  })
})
