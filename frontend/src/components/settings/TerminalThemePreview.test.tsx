import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TerminalThemePreview } from '@/components/settings/TerminalThemePreview'

it('previews the configured terminal selection background', () => {
  render(<TerminalThemePreview theme={{
    background: '#000000', foreground: '#ffffff', cursorColor: '#ffffff', selectionBackground: '#4f46e5',
    cursorStyle: 'bar', fontFamily: 'monospace', fontSize: 14, ansi: Array(16).fill('#111111'),
  }} />)

  expect(screen.getByTestId('terminal-selection-preview')).toHaveStyle({ backgroundColor: '#4f46e5' })
})
