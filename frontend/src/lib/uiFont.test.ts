import { beforeEach, describe, expect, it } from 'vitest'
import { applyUIFont, clampUIFontSize, normalizeUIFontFallbackFamily, normalizeUIFontFamily } from '@/lib/uiFont'

describe('uiFont', () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty('--app-font-family')
    document.documentElement.style.removeProperty('--app-font-size')
  })

  it('normalizes font family and clamps font size', () => {
    expect(normalizeUIFontFamily('  Segoe UI  ')).toBe('Segoe UI')
    expect(normalizeUIFontFamily('')).toBe('Geist Variable')
    expect(normalizeUIFontFallbackFamily('Microsoft YaHei', 'Segoe UI')).toBe('Microsoft YaHei')
    expect(normalizeUIFontFallbackFamily('Segoe UI', 'Segoe UI')).toBe('sans-serif')
    expect(clampUIFontSize(8)).toBe(12)
    expect(clampUIFontSize(30)).toBe(24)
    expect(clampUIFontSize(Number.NaN)).toBe(14)
  })

  it('applies quoted font family and size variables', () => {
    applyUIFont({ family: 'Segoe UI', fallbackFamily: 'Microsoft YaHei', size: 16 })

    expect(document.documentElement.style.getPropertyValue('--app-font-family')).toBe('"Segoe UI", "Microsoft YaHei", sans-serif')
    expect(document.documentElement.style.getPropertyValue('--app-font-size')).toBe('16px')
  })
})
