import { describe, expect, it } from 'vitest'
import { xtermTheme } from '@/lib/terminalTheme'

it('passes the configured selection background to xterm', () => {
  const theme = {
    background: '#000000', foreground: '#ffffff', cursor: '#ffffff', cursorAccent: '#000000',
    selectionBackground: '#4f46e5', cursorStyle: 'bar' as const, fontFamily: 'monospace', fontSize: 14,
    ansiBlack: '#000000', ansiRed: '#111111', ansiGreen: '#222222', ansiYellow: '#333333',
    ansiBlue: '#444444', ansiMagenta: '#555555', ansiCyan: '#666666', ansiWhite: '#777777',
    ansiBrightBlack: '#888888', ansiBrightRed: '#999999', ansiBrightGreen: '#aaaaaa', ansiBrightYellow: '#bbbbbb',
    ansiBrightBlue: '#cccccc', ansiBrightMagenta: '#dddddd', ansiBrightCyan: '#eeeeee', ansiBrightWhite: '#ffffff',
  }

  expect(xtermTheme(theme).selectionBackground).toBe('#4f46e5')
})
