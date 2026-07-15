import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { TerminalProfileStyleEditor } from '@/components/settings/TerminalProfileStyleEditor'
import type { ThemeDraft } from '@/components/settings/themeEditorState'

const globalStyle = { font_family: 'Global Font', font_size: 16, cursor_style: 'underline' as const }

describe('TerminalProfileStyleEditor', () => {
  it('shows effective global values while following and disables fallback fields', () => {
    render(<TerminalProfileStyleEditor draft={draft()} globalStyle={globalStyle as never} onDraftChange={vi.fn()} />)

    expect(screen.getByRole('switch', { name: '跟随全局字体与光标' })).toBeChecked()
    expect(screen.getByLabelText('主题字体')).toHaveValue('Global Font')
    expect(screen.getByLabelText('主题字号')).toHaveValue(16)
    expect(screen.getByRole('combobox', { name: '主题光标样式' })).toHaveTextContent('下划线')
    expect(screen.getByLabelText('主题字体')).toBeDisabled()
    expect(screen.getByLabelText('选区背景色 HEX')).toHaveValue('#264f78')
    expect(screen.getByLabelText('选区背景色 HEX')).toBeEnabled()
    expect(screen.queryByLabelText('光标颜色 HEX')).not.toBeInTheDocument()
  })

  it('edits the Profile selection background while global typography is followed', async () => {
    render(<ProfileStyleHarness />)

    await userEvent.clear(screen.getByLabelText('选区背景色 HEX'))
    await userEvent.type(screen.getByLabelText('选区背景色 HEX'), '#4f46e5')

    expect(screen.getByLabelText('选区背景色 HEX')).toHaveValue('#4f46e5')
    expect(screen.getByRole('switch', { name: '跟随全局字体与光标' })).toBeChecked()
  })

  it('restores and edits Profile fallback values when following is disabled', async () => {
    render(<ProfileStyleHarness />)

    await userEvent.click(screen.getByRole('switch', { name: '跟随全局字体与光标' }))
    expect(screen.getByLabelText('主题字体')).toHaveValue('Profile Font')
    expect(screen.getByLabelText('主题字号')).toHaveValue(19)
    expect(screen.getByLabelText('主题字体')).toBeEnabled()

    await userEvent.clear(screen.getByLabelText('主题字体'))
    await userEvent.type(screen.getByLabelText('主题字体'), 'Edited Font')
    await userEvent.clear(screen.getByLabelText('主题字号'))
    await userEvent.type(screen.getByLabelText('主题字号'), '21')
    await userEvent.click(screen.getByRole('combobox', { name: '主题光标样式' }))
    await userEvent.click(await screen.findByRole('option', { name: '竖线' }))
    await userEvent.click(screen.getByRole('switch', { name: '跟随全局字体与光标' }))
    expect(screen.getByLabelText('主题字体')).toHaveValue('Global Font')
    await userEvent.click(screen.getByRole('switch', { name: '跟随全局字体与光标' }))

    expect(screen.getByLabelText('主题字体')).toHaveValue('Edited Font')
    expect(screen.getByLabelText('主题字号')).toHaveValue(21)
    expect(screen.getByRole('combobox', { name: '主题光标样式' })).toHaveTextContent('竖线')
  })

  it('reports invalid fallback sizes while independent', async () => {
    render(<ProfileStyleHarness />)
    await userEvent.click(screen.getByRole('switch', { name: '跟随全局字体与光标' }))
    await userEvent.clear(screen.getByLabelText('主题字号'))

    expect(screen.getByLabelText('主题字号')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('字号必须是 8 到 48 的整数')
  })

  it('disables the follow control while saving', () => {
    render(<TerminalProfileStyleEditor draft={draft()} globalStyle={globalStyle as never} disabled onDraftChange={vi.fn()} />)

    expect(screen.getByRole('switch', { name: '跟随全局字体与光标' })).toHaveAttribute('aria-disabled', 'true')
  })
})

function ProfileStyleHarness() {
  const [value, setValue] = useState(draft())
  return <TerminalProfileStyleEditor draft={value} globalStyle={globalStyle as never} onDraftChange={setValue} />
}

function draft(): ThemeDraft {
  return {
    background: '#000000',
    foreground: '#ffffff',
    cursorColor: '#ffffff',
    cursorStyle: 'block',
    fontFamily: 'Profile Font',
    fontSize: 19,
    ansi: Array(16).fill('#111111'),
    selectionBackground: '#264f78',
    followGlobalStyle: true,
  }
}
