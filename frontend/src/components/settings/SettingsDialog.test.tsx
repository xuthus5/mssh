import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SettingsDialog from '@/components/settings/SettingsDialog'

const general = {
  maxPoolSize: 10,
  defaultKeepAlive: 60,
  defaultTermType: 'xterm-256color',
  uiFontFamily: 'Arial',
  uiFontFallbackFamily: 'Segoe UI',
  uiFontSize: 14,
  windowOpacity: 100,
}

function settingsProps() {
  return {
    open: true,
    onOpenChange: vi.fn(),
    general,
    systemFonts: ['Arial', 'Microsoft YaHei', 'Segoe UI'],
    themeProfiles: [themeProfile(1, 'dark', '#000000'), themeProfile(2, 'light', '#ffffff')],
    themeAssignments: { dark_profile_id: 1, light_profile_id: 2 },
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
  return { id, name: mode, theme_id: id, font_family: 'monospace', font_size: 14, cursor_style: 'bar' as const, color_overrides: '{}', created_at: '', updated_at: '', definition: { id, name: mode, mode, source_type: 'builtin' as const, source_name: '', source_url: '', source_author: '', source_license: '', source_version: '', source_fingerprint: mode, color_payload: JSON.stringify({ background, foreground: mode === 'dark' ? '#ffffff' : '#000000', cursor: '#888888', selection: '#264f78', ansi: Array(16).fill('#111111') }), raw_payload: '', is_builtin: true, created_at: '', updated_at: '' } }
}

describe('SettingsDialog interface font settings', () => {
  it('uses the terminal category for terminal theme settings', async () => {
    render(<SettingsDialog {...settingsProps()} />)

    expect(screen.getByRole('tab', { name: '终端' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '外观' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '分组' })).not.toBeInTheDocument()
  })

  it('previews and saves the selected font settings', async () => {
    const props = settingsProps()
    render(<SettingsDialog {...props} />)

    const fontInput = screen.getByRole('combobox', { name: '界面字体' })
    await userEvent.clear(fontInput)
    await userEvent.type(fontInput, 'YaHei')
    await userEvent.click(await screen.findByRole('option', { name: 'Microsoft YaHei' }))
    await userEvent.clear(screen.getByLabelText('界面字号'))
    await userEvent.type(screen.getByLabelText('界面字号'), '18')

    expect(props.onPreviewUIFont).toHaveBeenLastCalledWith('Microsoft YaHei', 'Segoe UI', 18)
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(props.onSaveGeneral).toHaveBeenCalledWith(expect.objectContaining({ uiFontFamily: 'Microsoft YaHei', uiFontSize: 18 }))
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
