import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ThemeEditor } from '@/components/settings/ThemeEditor'
import type { TerminalTheme } from '@/hooks/useSettings'

const theme: TerminalTheme = {
  background: '#101216',
  foreground: '#e6e8eb',
  cursorColor: '#ffd866',
  cursorStyle: 'bar',
  fontFamily: 'JetBrains Mono',
  fontSize: 14,
  ansi: Array.from({ length: 16 }, (_, index) => `#${index.toString(16).repeat(6)}`),
}

describe('ThemeEditor', () => {
  it('searches and applies a preset to the draft and preview', async () => {
    const onSave = vi.fn()
    render(<ThemeEditor theme={theme} onSave={onSave} />)

    const presetInput = screen.getByRole('combobox', { name: '主题预设' })
    await userEvent.clear(presetInput)
    await userEvent.type(presetInput, 'Dracula')
    await userEvent.click(await screen.findByRole('option', { name: /Dracula/ }))

    expect(screen.getByLabelText('背景色 HEX')).toHaveValue('#282a36')
    expect(screen.getByLabelText('前景色 HEX')).toHaveValue('#f8f8f2')
    expect(screen.getByLabelText('光标颜色 HEX')).toHaveValue('#f8f8f2')
    expect(screen.getByTestId('terminal-theme-preview')).toHaveStyle({
      backgroundColor: '#282a36',
      color: '#f8f8f2',
    })
    expect(onSave).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '保存主题' }))
    expect(onSave).toHaveBeenCalledOnce()
  })

  it('renders font and cursor settings in the live preview', () => {
    render(<ThemeEditor theme={theme} onSave={vi.fn()} />)

    expect(screen.getByTestId('terminal-theme-preview')).toHaveStyle({
      backgroundColor: '#101216',
      color: '#e6e8eb',
      fontFamily: 'JetBrains Mono',
      fontSize: '14px',
    })
    expect(screen.getByTestId('terminal-theme-cursor')).toHaveStyle({
      backgroundColor: '#ffd866',
    })
  })

  it('edits only the selected ANSI color', async () => {
    const onSave = vi.fn()
    render(<ThemeEditor theme={theme} onSave={onSave} />)

    await userEvent.click(screen.getByRole('radio', { name: 'ANSI 5 洋红' }))
    const ansiInput = screen.getByLabelText('洋红 HEX')
    await userEvent.clear(ansiInput)
    await userEvent.type(ansiInput, '#abcdef')
    await userEvent.click(screen.getByRole('button', { name: '保存主题' }))

    expect(onSave).toHaveBeenCalledWith({
      ...theme,
      ansi: theme.ansi.map((color, index) => index === 5 ? '#abcdef' : color),
    })
  })

  it('saves every draft property', async () => {
    const onSave = vi.fn()
    render(<ThemeEditor theme={theme} onSave={onSave} />)

    await userEvent.clear(screen.getByLabelText('终端字体'))
    await userEvent.type(screen.getByLabelText('终端字体'), 'Cascadia Code')
    await userEvent.clear(screen.getByLabelText('终端字号'))
    await userEvent.type(screen.getByLabelText('终端字号'), '18')
    await userEvent.click(screen.getByRole('button', { name: '保存主题' }))

    expect(onSave).toHaveBeenCalledWith({
      ...theme,
      fontFamily: 'Cascadia Code',
      fontSize: 18,
    })
  })

  it('updates base colors from precise and visual controls', async () => {
    const onSave = vi.fn()
    render(<ThemeEditor theme={theme} onSave={onSave} />)

    await userEvent.clear(screen.getByLabelText('背景色 HEX'))
    await userEvent.type(screen.getByLabelText('背景色 HEX'), '#123456')
    fireEvent.change(screen.getByLabelText('前景色选择器'), { target: { value: '#654321' } })
    fireEvent.change(screen.getByLabelText('光标颜色选择器'), { target: { value: '#abcdef' } })
    await userEvent.click(screen.getByRole('button', { name: '保存主题' }))

    expect(onSave).toHaveBeenCalledWith({
      ...theme,
      background: '#123456',
      foreground: '#654321',
      cursorColor: '#abcdef',
    })
  })

  it('updates the selected ANSI color from the visual picker', async () => {
    const onSave = vi.fn()
    render(<ThemeEditor theme={theme} onSave={onSave} />)

    await userEvent.click(screen.getByRole('radio', { name: 'ANSI 2 绿色' }))
    fireEvent.change(screen.getByLabelText('绿色 颜色'), { target: { value: '#12ab34' } })
    await userEvent.click(screen.getByRole('button', { name: '保存主题' }))

    expect(onSave).toHaveBeenCalledWith({
      ...theme,
      ansi: theme.ansi.map((color, index) => index === 2 ? '#12ab34' : color),
    })
  })

  it('uses the default size when the font size draft is empty', async () => {
    const onSave = vi.fn()
    render(<ThemeEditor theme={theme} onSave={onSave} />)

    await userEvent.clear(screen.getByLabelText('终端字号'))
    await userEvent.click(screen.getByRole('button', { name: '保存主题' }))

    expect(onSave).toHaveBeenCalledWith({ ...theme, fontSize: 14 })
  })

  it('blocks saving and identifies invalid HEX colors', async () => {
    const onSave = vi.fn()
    render(<ThemeEditor theme={theme} onSave={onSave} />)

    await userEvent.clear(screen.getByLabelText('背景色 HEX'))
    await userEvent.type(screen.getByLabelText('背景色 HEX'), 'invalid')

    expect(screen.getByLabelText('背景色 HEX')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('请输入 #RRGGBB 格式的颜色值。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存主题' })).toBeDisabled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('labels the cursor selector and previews all cursor styles', async () => {
    render(<ThemeEditor theme={theme} onSave={vi.fn()} />)

    await userEvent.click(screen.getByRole('combobox', { name: '光标样式' }))
    await userEvent.click(await screen.findByRole('option', { name: '下划线' }))
    expect(screen.getByTestId('terminal-theme-cursor')).toHaveStyle({ width: '0.7em', height: '2px' })

    await userEvent.click(screen.getByRole('combobox', { name: '光标样式' }))
    await userEvent.click(await screen.findByRole('option', { name: '方块' }))
    expect(screen.getByTestId('terminal-theme-cursor')).toHaveStyle({ width: '0.7em', height: '1.15em' })
  })

  it('supports arrow-key navigation across the ANSI color radio group', async () => {
    render(<ThemeEditor theme={theme} onSave={vi.fn()} />)

    const black = screen.getByRole('radio', { name: 'ANSI 0 黑色' })
    black.focus()
    await userEvent.keyboard('{ArrowRight}')

    expect(screen.getByRole('radio', { name: 'ANSI 1 红色' })).toHaveFocus()
    expect(screen.getByLabelText('红色 HEX')).toBeInTheDocument()
  })

  it('uses a safe ANSI fallback when persisted colors are missing', () => {
    render(<ThemeEditor theme={{ ...theme, ansi: [] }} onSave={vi.fn()} />)

    expect(screen.getByLabelText('黑色 HEX')).toHaveValue('#000000')
    expect(screen.getAllByRole('radio')).toHaveLength(16)
    expect(screen.getByRole('button', { name: '保存主题' })).toBeEnabled()
  })

  it('synchronizes the draft when the persisted theme changes', () => {
    const { rerender } = render(<ThemeEditor theme={theme} onSave={vi.fn()} />)
    const nextTheme = { ...theme, background: '#223344', fontSize: 20 }

    rerender(<ThemeEditor theme={nextTheme} onSave={vi.fn()} />)

    expect(screen.getByLabelText('背景色 HEX')).toHaveValue('#223344')
    expect(screen.getByLabelText('终端字号')).toHaveValue(20)
  })
})
