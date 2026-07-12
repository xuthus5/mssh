import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ThemeEditor } from '@/components/settings/ThemeEditor'

const profiles = [profile(1, 'GitHub Dark', 'dark', '#0d1117'), profile(2, 'GitHub Light', 'light', '#ffffff'), profile(3, 'Dracula', 'dark', '#282a36')]

describe('ThemeEditor dual mode profiles', () => {
  it('renders separate Dark and Light selectors', () => {
    renderEditor()
    expect(screen.getByRole('combobox', { name: 'Dark Mode 终端主题' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Light Mode 终端主题' })).toBeInTheDocument()
  })

  it('keeps Dark and Light drafts independent and saves atomically', async () => {
    const onSave = vi.fn(async () => {})
    renderEditor(onSave)
    await userEvent.clear(screen.getByLabelText('背景色 HEX'))
    await userEvent.type(screen.getByLabelText('背景色 HEX'), '#111111')
    await userEvent.click(screen.getByRole('tab', { name: 'Light Mode' }))
    expect(screen.getByLabelText('背景色 HEX')).toHaveValue('#ffffff')
    await userEvent.clear(screen.getByLabelText('背景色 HEX'))
    await userEvent.type(screen.getByLabelText('背景色 HEX'), '#fefefe')
    await userEvent.click(screen.getByRole('button', { name: '保存主题配置' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      dark_profile: expect.objectContaining({ id: 1, color_overrides: expect.stringContaining('#111111') }),
      light_profile: expect.objectContaining({ id: 2, color_overrides: expect.stringContaining('#fefefe') }),
      assignments: { dark_profile_id: 1, light_profile_id: 2 },
    }))
  })

  it('changes the Dark assignment without replacing the Light draft', async () => {
    const onSave = vi.fn(async () => {})
    renderEditor(onSave)
    const input = screen.getByRole('combobox', { name: 'Dark Mode 终端主题' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Dracula')
    await userEvent.click(await screen.findByRole('option', { name: /Dracula/ }))
    expect(screen.getByLabelText('背景色 HEX')).toHaveValue('#282a36')
    await userEvent.click(screen.getByRole('button', { name: '保存主题配置' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ assignments: { dark_profile_id: 3, light_profile_id: 2 } }))
  })
})

function renderEditor(onSave = vi.fn(async () => {})) {
  return render(<ThemeEditor profiles={profiles as never} assignments={{ dark_profile_id: 1, light_profile_id: 2 } as never} onSave={onSave} />)
}

function profile(id: number, name: string, mode: string, background: string) {
  return { id, name, theme_id: id, font_family: 'monospace', font_size: 14, cursor_style: 'bar', color_overrides: '{}', created_at: '', updated_at: '', definition: { id, name, mode, source_type: 'builtin', source_name: 'MSSH', source_url: '', source_author: '', source_license: 'MIT', source_version: '1', source_fingerprint: name, color_payload: JSON.stringify({ background, foreground: mode === 'dark' ? '#ffffff' : '#000000', cursor: '#888888', selection: '#264f78', ansi: Array(16).fill('#111111') }), raw_payload: '', is_builtin: true, created_at: '', updated_at: '' } }
}
