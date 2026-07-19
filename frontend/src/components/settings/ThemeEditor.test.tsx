import type { ComponentProps } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeEditor } from '@/components/settings/ThemeEditor'
import { useToastStore } from '@/components/ui/toast'

const profiles = [
  profile({ id: 1, name: 'GitHub Dark', mode: 'dark', background: '#0d1117' }),
  profile({ id: 2, name: 'GitHub Light', mode: 'light', background: '#ffffff' }),
  profile({ id: 3, name: 'Dracula', mode: 'dark', background: '#282a36' }),
]
const globalStyle = { font_family: 'Global Font', font_size: 16, cursor_style: 'underline' as const, selection_background: '#123456' }
type ThemeEditorProps = ComponentProps<typeof ThemeEditor>

describe('ThemeEditor dual mode profiles', () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }))

  it('renders separate Dark and Light selectors', () => {
    renderEditor()
    expect(screen.getByRole('switch', { name: '跟随界面模式' })).toBeChecked()
    expect(screen.getByRole('combobox', { name: 'Dark Mode 终端主题' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Light Mode 终端主题' })).toBeInTheDocument()
  })

  it('embeds the horizontal preview mode tabs in the preview header', () => {
    renderEditor()

    const tabs = screen.getByRole('tablist', { name: '预览模式' })
    expect(tabs.closest('[data-slot="card-header"]')).toHaveTextContent('实时终端预览')
    expect(tabs).toHaveAttribute('data-orientation', 'horizontal')
    expect(tabs).toHaveClass('flex-row')
    expect(screen.getByRole('tab', { name: 'Dark Mode' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Light Mode' })).toBeInTheDocument()
  })

  it('previews and saves global terminal style atomically', async () => {
    const onSave = vi.fn(async () => {})
    renderEditor({ onSave })

    expect(screen.getByTestId('terminal-theme-preview')).toHaveStyle({ fontFamily: 'Global Font', fontSize: '16px' })
    expect(screen.getByTestId('terminal-selection-preview')).toHaveStyle({ backgroundColor: '#123456' })
    await userEvent.clear(screen.getByLabelText('全局终端字体'))
    await userEvent.type(screen.getByLabelText('全局终端字体'), 'Cascadia Code')
    await userEvent.clear(screen.getByLabelText('全局选区背景色 HEX'))
    await userEvent.type(screen.getByLabelText('全局选区背景色 HEX'), '#4f46e5')
    expect(screen.getByTestId('terminal-theme-preview')).toHaveStyle({ fontFamily: 'Cascadia Code' })
    expect(screen.getByTestId('terminal-selection-preview')).toHaveStyle({ backgroundColor: '#4f46e5' })
    await userEvent.click(screen.getByRole('button', { name: '保存主题配置' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      global_style: { font_family: 'Cascadia Code', font_size: 16, cursor_style: 'underline', selection_background: '#4f46e5' },
      profiles: expect.arrayContaining([expect.objectContaining({ id: 1, follow_global_style: true, font_family: 'monospace' })]),
    }))
  })

  it('keeps an independent Profile style after global following is disabled', async () => {
    const onSave = vi.fn(async () => {})
    renderEditor({ onSave })

    await userEvent.click(screen.getByRole('switch', { name: '跟随全局字体与光标' }))
    await userEvent.clear(screen.getByLabelText('主题字体'))
    await userEvent.type(screen.getByLabelText('主题字体'), 'Profile Font')
    expect(screen.getByTestId('terminal-theme-preview')).toHaveStyle({ fontFamily: 'Profile Font' })
    await userEvent.click(screen.getByRole('button', { name: '保存主题配置' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      profiles: expect.arrayContaining([expect.objectContaining({ id: 1, follow_global_style: false, font_family: 'Profile Font' })]),
    }))
  })

  it('previews and saves the Profile selection background independently', async () => {
    const onSave = vi.fn<ThemeEditorProps['onSave']>(async () => {})
    renderEditor({ onSave })

    await userEvent.click(screen.getByRole('switch', { name: '跟随全局字体与光标' }))
    await userEvent.clear(screen.getByLabelText('主题选区背景色 HEX'))
    await userEvent.type(screen.getByLabelText('主题选区背景色 HEX'), '#4f46e5')
    expect(screen.getByTestId('terminal-selection-preview')).toHaveStyle({ backgroundColor: '#4f46e5' })
    await userEvent.click(screen.getByRole('button', { name: '保存主题配置' }))

    const configuration = onSave.mock.calls[0]?.[0]
    if (!configuration) throw new Error('theme configuration was not saved')
    const dark = configuration.profiles.find((profile: { id: number }) => profile.id === 1)
    if (!dark) throw new Error('dark theme Profile was not saved')
    expect(JSON.parse(dark.color_overrides)).toMatchObject({ selection: '#4f46e5' })
  })

  it('prevents saving invalid global and Profile style drafts', async () => {
    renderEditor()
    const saveButton = screen.getByRole('button', { name: '保存主题配置' })

    await userEvent.clear(screen.getByLabelText('全局终端字号'))
    expect(saveButton).toBeDisabled()
    await userEvent.type(screen.getByLabelText('全局终端字号'), '16')
    expect(saveButton).toBeEnabled()

    await userEvent.clear(screen.getByLabelText('全局选区背景色 HEX'))
    expect(saveButton).toBeDisabled()
    await userEvent.type(screen.getByLabelText('全局选区背景色 HEX'), '#123456')
    expect(saveButton).toBeEnabled()

    await userEvent.click(screen.getByRole('switch', { name: '跟随全局字体与光标' }))
    await userEvent.clear(screen.getByLabelText('主题字号'))
    expect(saveButton).toBeDisabled()
  })

  it('uses the current Light Profile when follow mode is disabled for the first time', async () => {
    const onSave = vi.fn(async () => {})
    renderEditor({ onSave, colorMode: 'light' })

    await userEvent.click(screen.getByRole('switch', { name: '跟随界面模式' }))

    expect(screen.getByRole('combobox', { name: '固定终端主题' })).toHaveValue('GitHub Light')
    expect(screen.queryByRole('tab', { name: 'Dark Mode' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '保存主题配置' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      assignments: { dark_profile_id: 1, light_profile_id: 2, follow_interface_mode: false, fixed_profile_id: 2 },
      profiles: expect.arrayContaining([expect.objectContaining({ id: 1 }), expect.objectContaining({ id: 2 })]),
    }))
  })

  it('preserves a previously selected fixed Profile and explains mode mismatch and sharing', async () => {
    renderEditor({ colorMode: 'light', assignments: { dark_profile_id: 3, light_profile_id: 2, follow_interface_mode: true, fixed_profile_id: 3 } })

    await userEvent.click(screen.getByRole('switch', { name: '跟随界面模式' }))

    expect(screen.getByRole('combobox', { name: '固定终端主题' })).toHaveValue('Dracula')
    expect(screen.getByRole('alert')).toHaveTextContent('当前界面为 Light Mode')
    expect(screen.getByText('同时用于 Dark Mode')).toBeInTheDocument()
  })

  it('keeps Dark and Light drafts independent and saves atomically', async () => {
    const onSave = vi.fn(async () => {})
    renderEditor({ onSave })
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
    renderEditor({ onSave })
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
    renderEditor({ onResetBuiltins })

    await userEvent.click(screen.getByRole('button', { name: '重置内置主题' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('恢复当前 Dark/Light 内置主题')
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onResetBuiltins).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: '重置内置主题' }))
    await userEvent.click(screen.getByRole('button', { name: '确认重置' }))

    expect(onResetBuiltins).toHaveBeenCalledOnce()
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe('已重置 Dark、Light 内置主题')
  })

  it('disables reset when neither assigned profile is built in', () => {
    const customProfiles = [profile({ id: 1, name: 'Custom Dark', mode: 'dark', background: '#111111', builtIn: false }), profile({ id: 2, name: 'Custom Light', mode: 'light', background: '#eeeeee', builtIn: false })]
    render(<ThemeEditor profiles={customProfiles as never} assignments={{ dark_profile_id: 1, light_profile_id: 2, follow_interface_mode: true, fixed_profile_id: 0 } as never} globalStyle={globalStyle as never} colorMode="dark" onSave={vi.fn()} onResetBuiltins={vi.fn()} />)

    expect(screen.getByRole('button', { name: '重置内置主题' })).toBeDisabled()
  })

  it('only includes the fixed built-in Profile in reset eligibility while fixed mode is active', () => {
    const mixedProfiles = [profile({ id: 1, name: 'Custom Dark', mode: 'dark', background: '#111111', builtIn: false }), profile({ id: 2, name: 'Custom Light', mode: 'light', background: '#eeeeee', builtIn: false }), profile({ id: 3, name: 'Dracula', mode: 'dark', background: '#282a36' })]
    const { rerender } = render(<ThemeEditor profiles={mixedProfiles as never} assignments={{ dark_profile_id: 1, light_profile_id: 2, follow_interface_mode: true, fixed_profile_id: 3 } as never} globalStyle={globalStyle as never} colorMode="dark" onSave={vi.fn()} onResetBuiltins={vi.fn()} />)
    expect(screen.getByRole('button', { name: '重置内置主题' })).toBeDisabled()

    rerender(<ThemeEditor profiles={mixedProfiles as never} assignments={{ dark_profile_id: 1, light_profile_id: 2, follow_interface_mode: false, fixed_profile_id: 3 } as never} globalStyle={globalStyle as never} colorMode="dark" onSave={vi.fn()} onResetBuiltins={vi.fn()} />)
    expect(screen.getByRole('button', { name: '重置内置主题' })).toBeEnabled()
  })

  it('keeps edited colors when saving fails', async () => {
    renderEditor({ onSave: vi.fn(async () => { throw new Error('db failed') }) })
    await userEvent.clear(screen.getByLabelText('背景色 HEX'))
    await userEvent.type(screen.getByLabelText('背景色 HEX'), '#123456')

    await userEvent.click(screen.getByRole('button', { name: '保存主题配置' }))

    expect(screen.getByLabelText('背景色 HEX')).toHaveValue('#123456')
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe('保存终端主题失败: db failed')
  })

  it('disables reset while a save request is pending', async () => {
    let resolveSave: (() => void) | undefined
    const onSave = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve }))
    renderEditor({ onSave })

    await userEvent.click(screen.getByRole('button', { name: '保存主题配置' }))

    expect(screen.getByRole('button', { name: '重置内置主题' })).toBeDisabled()
    await act(async () => { resolveSave?.() })
  })

  it('keeps save disabled when a historical fixed Profile draft is invalid', async () => {
    renderEditor({ assignments: { dark_profile_id: 1, light_profile_id: 2, follow_interface_mode: true, fixed_profile_id: 3 } })
    await userEvent.click(screen.getByRole('switch', { name: '跟随界面模式' }))
    await userEvent.clear(screen.getByLabelText('背景色 HEX'))
    await userEvent.type(screen.getByLabelText('背景色 HEX'), '#123')
    await userEvent.click(screen.getByRole('switch', { name: '跟随界面模式' }))

    const saveButton = document.querySelector('button[type="submit"]')
    expect(saveButton).toBeDisabled()
  })

  it('disables save while a reset request is pending', async () => {
    let resolveReset: ((result: { dark_reset: boolean; light_reset: boolean; fixed_reset: boolean }) => void) | undefined
    const onResetBuiltins = vi.fn(() => new Promise<{ dark_reset: boolean; light_reset: boolean; fixed_reset: boolean }>((resolve) => { resolveReset = resolve }))
    renderEditor({ onResetBuiltins })
    await userEvent.click(screen.getByRole('button', { name: '重置内置主题' }))
    await userEvent.click(screen.getByRole('button', { name: '确认重置' }))

    const saveButton = document.querySelector('button[type="submit"]')
    expect(saveButton).toBeDisabled()
    await act(async () => { resolveReset?.({ dark_reset: true, light_reset: true, fixed_reset: false }) })
  })

  it('keeps the current draft when reset fails', async () => {
    const onResetBuiltins = vi.fn(async () => { throw new Error('db failed') })
    renderEditor({ onResetBuiltins })

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
    renderEditor({ onResetBuiltins })
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
    [{ dark_reset: false, light_reset: false, fixed_reset: true }, '已重置固定内置主题'],
  ])('reports partial reset result %o', async (result, message) => {
    renderEditor({ onResetBuiltins: vi.fn(async () => result) })
    await userEvent.click(screen.getByRole('button', { name: '重置内置主题' }))
    await userEvent.click(screen.getByRole('button', { name: '确认重置' }))
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(message)
  })
})

function renderEditor({
  onSave = vi.fn(async () => {}),
  onResetBuiltins = vi.fn(async () => ({ dark_reset: false, light_reset: false, fixed_reset: false })),
  colorMode = 'dark',
  assignments = { dark_profile_id: 1, light_profile_id: 2, follow_interface_mode: true, fixed_profile_id: 0 },
}: {
  onSave?: ThemeEditorProps['onSave']
  onResetBuiltins?: ThemeEditorProps['onResetBuiltins']
  colorMode?: 'dark' | 'light'
  assignments?: { dark_profile_id: number; light_profile_id: number; follow_interface_mode: boolean; fixed_profile_id: number }
} = {}) {
  return render(<ThemeEditor profiles={profiles as never} assignments={assignments as never} globalStyle={globalStyle as never} colorMode={colorMode} onSave={onSave} onResetBuiltins={onResetBuiltins} />)
}

function profile({ id, name, mode, background, builtIn = true }: { id: number; name: string; mode: string; background: string; builtIn?: boolean }) {
  return { id, name, theme_id: id, follow_global_style: true, font_family: 'monospace', font_size: 14, cursor_style: 'bar', color_overrides: '{}', created_at: '', updated_at: '', definition: { id, name, mode, source_type: builtIn ? 'builtin' : 'custom', source_name: 'MSSH', source_url: '', source_author: '', source_license: 'MIT', source_version: '1', source_fingerprint: name, color_payload: JSON.stringify({ background, foreground: mode === 'dark' ? '#ffffff' : '#000000', cursor: '#888888', selection: '#264f78', ansi: Array(16).fill('#111111') }), raw_payload: '', is_builtin: builtIn, created_at: '', updated_at: '' } }
}
