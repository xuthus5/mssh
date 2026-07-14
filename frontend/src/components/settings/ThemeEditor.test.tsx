import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeEditor } from '@/components/settings/ThemeEditor'
import { useToastStore } from '@/components/ui/toast'

const profiles = [profile(1, 'GitHub Dark', 'dark', '#0d1117'), profile(2, 'GitHub Light', 'light', '#ffffff'), profile(3, 'Dracula', 'dark', '#282a36')]

describe('ThemeEditor dual mode profiles', () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }))

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
      profiles: expect.arrayContaining([
        expect.objectContaining({ id: 1, color_overrides: expect.stringContaining('#111111') }),
        expect.objectContaining({ id: 2, color_overrides: expect.stringContaining('#fefefe') }),
      ]),
      assignments: { dark_profile_id: 1, light_profile_id: 2, follow_interface_mode: true, fixed_profile_id: 0 },
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
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ assignments: { dark_profile_id: 3, light_profile_id: 2, follow_interface_mode: true, fixed_profile_id: 0 } }))
  })

  it('confirms and resets the assigned built-in theme styles', async () => {
    const onResetBuiltins = vi.fn(async () => ({ dark_reset: true, light_reset: true, fixed_reset: false }))
    renderEditor(vi.fn(async () => {}), onResetBuiltins)

    await userEvent.click(screen.getByRole('button', { name: '重置内置主题' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('恢复当前 Dark/Light 内置主题')
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onResetBuiltins).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: '重置内置主题' }))
    await userEvent.click(screen.getByRole('button', { name: '确认重置' }))

    expect(onResetBuiltins).toHaveBeenCalledOnce()
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe('已重置 Dark 和 Light 内置主题')
  })

  it('disables reset when neither assigned profile is built in', () => {
    const customProfiles = [profile(1, 'Custom Dark', 'dark', '#111111', false), profile(2, 'Custom Light', 'light', '#eeeeee', false)]
    render(<ThemeEditor profiles={customProfiles as never} assignments={{ dark_profile_id: 1, light_profile_id: 2 } as never} onSave={vi.fn()} onResetBuiltins={vi.fn()} />)

    expect(screen.getByRole('button', { name: '重置内置主题' })).toBeDisabled()
  })

  it('keeps the current draft when reset fails', async () => {
    const onResetBuiltins = vi.fn(async () => { throw new Error('db failed') })
    renderEditor(vi.fn(async () => {}), onResetBuiltins)

    await userEvent.click(screen.getByRole('button', { name: '重置内置主题' }))
    await userEvent.click(screen.getByRole('button', { name: '确认重置' }))

    expect(screen.getByLabelText('背景色 HEX')).toHaveValue('#0d1117')
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe('重置内置主题失败: db failed')
  })

  it('disables reset while the editor has unsaved changes', async () => {
    renderEditor()
    await userEvent.clear(screen.getByLabelText('背景色 HEX'))
    await userEvent.type(screen.getByLabelText('背景色 HEX'), '#123456')

    const button = screen.getByRole('button', { name: '重置内置主题' })
    expect(button).toBeDisabled()
    const trigger = button.closest('[data-slot="tooltip-trigger"]')
    if (!trigger) throw new Error('reset tooltip trigger not found')
    await userEvent.hover(trigger)
    expect(await screen.findByText('请先保存或撤销当前主题修改')).toBeInTheDocument()
  })

  it('prevents duplicate reset submissions while the request is pending', async () => {
    let resolveReset: ((result: { dark_reset: boolean; light_reset: boolean; fixed_reset: boolean }) => void) | undefined
    const onResetBuiltins = vi.fn(() => new Promise<{ dark_reset: boolean; light_reset: boolean; fixed_reset: boolean }>((resolve) => { resolveReset = resolve }))
    renderEditor(vi.fn(async () => {}), onResetBuiltins)
    await userEvent.click(screen.getByRole('button', { name: '重置内置主题' }))
    await userEvent.click(screen.getByRole('button', { name: '确认重置' }))

    expect(screen.getByRole('button', { name: /重置中/ })).toBeDisabled()
    expect(onResetBuiltins).toHaveBeenCalledOnce()
    await act(async () => { resolveReset?.({ dark_reset: true, light_reset: false, fixed_reset: false }) })
  })

  it.each([
    [{ dark_reset: true, light_reset: false, fixed_reset: false }, '已重置 Dark 内置主题'],
    [{ dark_reset: false, light_reset: true, fixed_reset: false }, '已重置 Light 内置主题'],
    [{ dark_reset: false, light_reset: false, fixed_reset: false }, '当前绑定没有可重置的内置主题'],
  ])('reports partial reset result %o', async (result, message) => {
    renderEditor(vi.fn(async () => {}), vi.fn(async () => result))
    await userEvent.click(screen.getByRole('button', { name: '重置内置主题' }))
    await userEvent.click(screen.getByRole('button', { name: '确认重置' }))
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(message)
  })
})

function renderEditor(onSave = vi.fn(async () => {}), onResetBuiltins = vi.fn(async () => ({ dark_reset: false, light_reset: false, fixed_reset: false }))) {
  return render(<ThemeEditor profiles={profiles as never} assignments={{ dark_profile_id: 1, light_profile_id: 2, follow_interface_mode: true, fixed_profile_id: 0 } as never} onSave={onSave} onResetBuiltins={onResetBuiltins} />)
}

function profile(id: number, name: string, mode: string, background: string, builtIn = true) {
  return { id, name, theme_id: id, font_family: 'monospace', font_size: 14, cursor_style: 'bar', color_overrides: '{}', created_at: '', updated_at: '', definition: { id, name, mode, source_type: builtIn ? 'builtin' : 'custom', source_name: 'MSSH', source_url: '', source_author: '', source_license: 'MIT', source_version: '1', source_fingerprint: name, color_payload: JSON.stringify({ background, foreground: mode === 'dark' ? '#ffffff' : '#000000', cursor: '#888888', selection: '#264f78', ansi: Array(16).fill('#111111') }), raw_payload: '', is_builtin: builtIn, created_at: '', updated_at: '' } }
}
