import { create } from 'zustand'

export interface KeywordHighlightRule {
  keyword: string
  color: string
}

export interface KeywordHighlightSettings {
  enabled: boolean
  /** When true, keyword matching ignores letter case; when false, matching is case-sensitive. */
  caseInsensitive: boolean
  rules: KeywordHighlightRule[]
}

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i
const DEFAULT_RULE_COLOR = '#e06c75'

export const DEFAULT_KEYWORD_HIGHLIGHT_RULES: KeywordHighlightRule[] = [
  { keyword: 'Error', color: '#ff5555' },
  { keyword: 'Warning', color: '#ffb86c' },
  { keyword: 'Info', color: '#8be9fd' },
  { keyword: 'Debug', color: '#bd93f9' },
  { keyword: 'Trace', color: '#50fa7b' },
  { keyword: 'Panic', color: '#ff79c6' },
  { keyword: 'OK', color: '#50fa7b' },
]

export const DEFAULT_KEYWORD_HIGHLIGHT_SETTINGS: KeywordHighlightSettings = {
  enabled: true,
  caseInsensitive: true,
  rules: DEFAULT_KEYWORD_HIGHLIGHT_RULES,
}

export function normalizeHexColor(value: unknown): string {
  if (typeof value === 'string' && HEX_COLOR_PATTERN.test(value.trim())) return value.trim().toLowerCase()
  return DEFAULT_RULE_COLOR
}

function normalizeRule(value: unknown): KeywordHighlightRule | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const keyword = typeof record.keyword === 'string' ? record.keyword.trim() : ''
  if (!keyword) return null
  return { keyword, color: normalizeHexColor(record.color) }
}

export function normalizeKeywordHighlightSettings(value: unknown): KeywordHighlightSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_KEYWORD_HIGHLIGHT_SETTINGS
  const record = value as Record<string, unknown>
  const rules: KeywordHighlightRule[] = []
  if (Array.isArray(record.rules)) {
    for (const raw of record.rules) {
      const rule = normalizeRule(raw)
      if (!rule) continue
      if (rules.some((existing) => existing.keyword.toLowerCase() === rule.keyword.toLowerCase())) continue
      rules.push(rule)
    }
  }
  return { enabled: record.enabled !== false, caseInsensitive: record.caseInsensitive !== false, rules }
}

export function orderRules(rules: KeywordHighlightRule[]): KeywordHighlightRule[] {
  return [...rules].sort((left, right) => right.keyword.length - left.keyword.length)
}

interface KeywordHighlightState extends KeywordHighlightSettings {
  setSettings: (settings: KeywordHighlightSettings) => void
  resetToDefault: () => void
}

export const useTerminalKeywordHighlightStore = create<KeywordHighlightState>((set) => ({
  ...DEFAULT_KEYWORD_HIGHLIGHT_SETTINGS,
  setSettings: (settings) => set(normalizeKeywordHighlightSettings(settings)),
  resetToDefault: () => set({ ...DEFAULT_KEYWORD_HIGHLIGHT_SETTINGS }),
}))