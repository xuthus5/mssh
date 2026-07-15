import { describe, expect, it } from 'vitest'
import { hasValidTerminalThemeColors, normalizeTerminalThemeColors } from '@/components/settings/terminalThemeValidation'

const theme = {
  background: '#000000', foreground: '#ffffff', cursorColor: '#ffffff', selectionBackground: '#264f78',
  cursorStyle: 'bar' as const, fontFamily: 'monospace', fontSize: 14, ansi: Array(16).fill('#111111'),
}

describe('terminal theme validation', () => {
  it('validates the selection background with all terminal colors', () => {
    expect(hasValidTerminalThemeColors(theme)).toBe(true)
    expect(hasValidTerminalThemeColors({ ...theme, selectionBackground: '#fff' })).toBe(false)
  })

  it('normalizes the selection background before persistence', () => {
    expect(normalizeTerminalThemeColors({ ...theme, selectionBackground: '#ABCDEF' }).selectionBackground).toBe('#abcdef')
  })
})
