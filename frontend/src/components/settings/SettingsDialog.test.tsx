import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SettingsDialog from '@/components/settings/SettingsDialog'
import { CursorStyle } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

const general = {
  maxPoolSize: 10,
  defaultKeepAlive: 60,
  defaultTermType: 'xterm-256color',
  uiFontFamily: 'Arial',
  uiFontFallbackFamily: 'Segoe UI',
  uiFontSize: 14,
  windowOpacity: 100,
  rightClickAction: 'menu' as const,
  copyOnSelect: false,
}

function settingsProps() {
  return {
    open: true,
    onOpenChange: vi.fn(),
    general,
    systemFonts: ['Arial', 'Microsoft YaHei', 'Segoe UI'],
    themeProfiles: [themeProfile(1, 'dark', '#000000'), themeProfile(2, 'light', '#ffffff')],
    themeAssignments: { dark_profile_id: 1, light_profile_id: 2, follow_interface_mode: true, fixed_profile_id: 0 },
    terminalGlobalStyle: { font_family: 'Global Font', font_size: 16, cursor_style: CursorStyle.CursorStyleUnderline },
    colorMode: 'dark' as const,
    keys: [],
    sync: { enabled: false, url: '', username: '', password: '' },
    onSaveGeneral: vi.fn(async () => {}),
    onPreviewUIFont: vi.fn(),
    onRestoreUIFont: vi.fn(),
    onPreviewWindowOpacity: vi.fn(),
    onRestoreWindowOpacity: vi.fn(),
    onSaveThemeConfiguration: vi.fn(async () => {}),
    onImportThemes: vi.fn(async () => ({ results: [] })),
    onCreateThemeProfile: vi.fn(async () => null),
    onUpdateThemeProfile: vi.fn(async () => {}),
    onDeleteThemeProfile: vi.fn(async () => {}),
    onDeleteThemeDefinition: vi.fn(async () => {}),
    onResetBuiltinThemes: vi.fn(async () => ({ dark_reset: true, light_reset: true, fixed_reset: false })),
    onGenerateKey: vi.fn(),
    onImportKey: vi.fn(),
    onDeleteKey: vi.fn(),
    onExportKey: vi.fn(async () => undefined),
    onSaveSync: vi.fn(),
    onExportConfig: vi.fn(),
    onImportConfig: vi.fn(),
  }
}

function themeProfile(id: number, mode: 'dark' | 'light', background: string): any {
  return { id, name: mode, theme_id: id, follow_global_style: true, font_family: 'monospace', font_size: 14, cursor_style: 'bar' as const, color_overrides: '{}', created_at: '', updated_at: '', definition: { id, name: mode, mode, source_type: 'builtin' as const, source_name: '', source_url: '', source_author: '', source_license: '', source_version: '', source_fingerprint: mode, color_payload: JSON.stringify({ background, foreground: mode === 'dark' ? '#ffffff' : '#000000', cursor: '#888888', selection: '#264f78', ansi: Array(16).fill('#111111') }), raw_payload: '', is_builtin: true, created_at: '', updated_at: '' } }
}

describe('SettingsDialog interface font settings', () => {
  it('uses the terminal category for terminal theme settings', async () => {
    render(<SettingsDialog {...settingsProps()} />)

    expect(screen.getByRole('tab', { name: '终端' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '外观' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '分组' })).not.toBeInTheDocument()
  })

  it('passes the built-in theme reset action to the terminal editor', async () => {
    const props = settingsProps()
    render(<SettingsDialog {...props} />)

    await userEvent.click(screen.getByRole('tab', { name: '终端' }))
    expect(screen.getByLabelText('全局终端字体')).toHaveValue('Global Font')
    await userEvent.click(screen.getByRole('button', { name: '重置内置主题' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('全局字体与光标配置不会被修改')
    await userEvent.click(screen.getByRole('button', { name: '确认重置' }))

    expect(props.onResetBuiltinThemes).toHaveBeenCalledOnce()
  })

  it('previews and saves the selected font settings', async () => {
    const props = settingsProps()
    render(<SettingsDialog {...props} />)

    expect(screen.getByText(/终端排版请在“终端”分类中配置/)).toBeInTheDocument()

    const fontInput = screen.getByRole('combobox', { name: '界面字体' })
    await userEvent.clear(fontInput)
    await userEvent.type(fontInput, 'YaHei')
    await userEvent.click(await screen.findByRole('option', { name: 'Microsoft YaHei' }))
    await userEvent.clear(screen.getByLabelText('界面字号'))
    await userEvent.type(screen.getByLabelText('界面字号'), '18')

    expect(props.onPreviewUIFont).toHaveBeenLastCalledWith('Microsoft YaHei', 'Segoe UI', 18)
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(props.onSaveGeneral).toHaveBeenCalledWith(expect.objectContaining({ uiFontFamily: 'Microsoft YaHei', uiFontSize: 18, rightClickAction: 'menu', copyOnSelect: false }))
  })

  it('saves changed terminal behavior settings', async () => {
    const props = settingsProps()
    const user = userEvent.setup()
    render(<SettingsDialog {...props} />)

    await user.click(screen.getByRole('combobox', { name: '鼠标右键行为' }))
    await user.click(await screen.findByRole('option', { name: '粘贴' }))
    await user.click(screen.getByRole('switch', { name: '选择即复制' }))
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(props.onSaveGeneral).toHaveBeenCalledWith(expect.objectContaining({ rightClickAction: 'paste', copyOnSelect: true }))
  })

  it('previews and saves a distinct fallback font', async () => {
    const props = settingsProps()
    render(<SettingsDialog {...props} />)

    const fallbackInput = screen.getByRole('combobox', { name: 'Fallback 字体' })
    await userEvent.clear(fallbackInput)
    await userEvent.type(fallbackInput, 'YaHei')
    await userEvent.click(await screen.findByRole('option', { name: 'Microsoft YaHei' }))

    expect(props.onPreviewUIFont).toHaveBeenLastCalledWith('Arial', 'Microsoft YaHei', 14)
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(props.onSaveGeneral).toHaveBeenCalledWith(expect.objectContaining({ uiFontFallbackFamily: 'Microsoft YaHei' }))
  })

  it('resets fallback when the primary font selects the same family', async () => {
    const props = settingsProps()
    render(<SettingsDialog {...props} />)

    const fontInput = screen.getByRole('combobox', { name: '界面字体' })
    await userEvent.clear(fontInput)
    await userEvent.type(fontInput, 'Segoe')
    await userEvent.click(await screen.findByRole('option', { name: 'Segoe UI' }))

    expect(props.onPreviewUIFont).toHaveBeenLastCalledWith('Segoe UI', 'sans-serif', 14)
  })

  it('restores persisted font settings when closing without saving', async () => {
    const props = settingsProps()
    render(<SettingsDialog {...props} />)

    await userEvent.clear(screen.getByLabelText('界面字号'))
    await userEvent.type(screen.getByLabelText('界面字号'), '20')
    await userEvent.keyboard('{Escape}')

    expect(props.onRestoreUIFont).toHaveBeenCalledOnce()
    expect(props.onRestoreWindowOpacity).toHaveBeenCalledOnce()
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('previews application opacity and exposes the compatibility warning', async () => {
    const props = settingsProps()
    render(<SettingsDialog {...props} />)

    const opacityInput = screen.getByLabelText('应用透明度百分比')
    await userEvent.clear(opacityInput)
    await userEvent.type(opacityInput, '72')

    expect(props.onPreviewWindowOpacity).toHaveBeenLastCalledWith(72)
    await userEvent.hover(screen.getByRole('button', { name: '透明度兼容性说明' }))
    expect(await screen.findByText('部分桌面环境不支持窗口透明度合成显示。')).toBeInTheDocument()
  })
})
