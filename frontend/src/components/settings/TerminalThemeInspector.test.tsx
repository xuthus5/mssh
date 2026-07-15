import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TerminalThemeInspector } from '@/components/settings/TerminalThemeInspector'

const theme = {
  background: '#000000',
  foreground: '#ffffff',
  cursorColor: '#888888',
  selectionBackground: '#264f78',
  cursorStyle: 'bar' as const,
  fontFamily: 'monospace',
  fontSize: 14,
  ansi: Array(16).fill('#111111'),
}

describe('TerminalThemeInspector', () => {
  it('edits Profile-owned terminal colors', async () => {
    const onThemeChange = vi.fn()
    render(<TerminalThemeInspector theme={theme} onThemeChange={onThemeChange} />)

    await userEvent.clear(screen.getByLabelText('背景色 HEX'))
    await userEvent.type(screen.getByLabelText('背景色 HEX'), '#123456')
    await userEvent.clear(screen.getByLabelText('光标颜色 HEX'))
    await userEvent.type(screen.getByLabelText('光标颜色 HEX'), '#abcdef')

    expect(onThemeChange).toHaveBeenCalledWith('background', expect.any(String))
    expect(onThemeChange).toHaveBeenCalledWith('cursorColor', expect.any(String))
  })

  it('reports invalid HEX colors', async () => {
    render(<TerminalThemeInspector theme={{ ...theme, foreground: '#fff' }} onThemeChange={vi.fn()} />)

    expect(screen.getByLabelText('前景色 HEX')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('请输入 #RRGGBB 格式的颜色值')
  })
})
