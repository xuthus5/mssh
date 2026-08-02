import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KEYWORD_HIGHLIGHT_RULES,
  normalizeHexColor,
  normalizeKeywordHighlightSettings,
} from '@/store/terminalKeywordHighlightStore'

describe('normalizeKeywordHighlightSettings', () => {
  it('returns defaults for invalid input', () => {
    expect(normalizeKeywordHighlightSettings(undefined).enabled).toBe(true)
    expect(normalizeKeywordHighlightSettings(undefined).caseInsensitive).toBe(true)
    expect(normalizeKeywordHighlightSettings(null).rules).toEqual(DEFAULT_KEYWORD_HIGHLIGHT_RULES)
    expect(normalizeKeywordHighlightSettings('nope').rules.length).toBeGreaterThan(0)
  })

  it('keeps caseInsensitive false when explicitly set', () => {
    const result = normalizeKeywordHighlightSettings({ enabled: true, caseInsensitive: false, rules: [] })
    expect(result.enabled).toBe(true)
    expect(result.caseInsensitive).toBe(false)
    expect(result.rules).toEqual([])
  })

  it('keeps enabled false when explicitly set', () => {
    const result = normalizeKeywordHighlightSettings({ enabled: false, rules: [{ keyword: 'OK', color: '#00ff00' }] })
    expect(result.enabled).toBe(false)
    expect(result.rules).toEqual([{ keyword: 'OK', color: '#00ff00' }])
  })

  it('drops blank keywords and dedupes case-insensitively', () => {
    const result = normalizeKeywordHighlightSettings({
      enabled: true,
      rules: [
        { keyword: '  ', color: '#000000' },
        { keyword: 'Error', color: '#ff0000' },
        { keyword: 'error', color: '#00ff00' },
        { keyword: 'Warn', color: '#ffff00' },
      ],
    })
    expect(result.rules.length).toBe(2)
    expect(result.rules[0].keyword).toBe('Error')
  })

  it('normalizes colours to lowercase and fixes invalid hex', () => {
    const result = normalizeKeywordHighlightSettings({
      enabled: true,
      rules: [{ keyword: 'Warn', color: '#FF0000' }, { keyword: 'Bad', color: 'nope' }],
    })
    expect(result.rules[0].color).toBe('#ff0000')
    expect(result.rules[1].color).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('normalizeHexColor', () => {
  it('normalizes valid hex and falls back on invalid values', () => {
    expect(normalizeHexColor('#AbCdEf')).toBe('#abcdef')
    expect(normalizeHexColor(123)).toMatch(/^#[0-9a-f]{6}$/)
    expect(normalizeHexColor('#12345')).toMatch(/^#[0-9a-f]{6}$/)
  })
})