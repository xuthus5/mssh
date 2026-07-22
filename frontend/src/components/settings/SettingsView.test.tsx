import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsView } from '@/components/settings/SettingsView'
import { CursorStyle } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

const general = {
  maxPoolSize: 10,
  defaultKeepAlive: 60,
  defaultTermType: 'xterm-256color',
  uiFontFamily: 'Arial',
  uiFontFallbackFamily: 'Segoe UI',
  uiFontSize: 14,
  rightClickAction: 'menu' as const,
  copyOnSelect: false,
  scrollbackLines: 10000,
  autoReconnect: false,
  restoreTabsOnStartup: true,
  renderer: 'dom' as const,
  historyPredict: false,
  closeButtonAction: 'tray' as const,
  logDir: '',
  logRetentionDays: 30,
  proxyMode: 'system' as const,
  proxyURL: '',
  proxyNoProxy: '',
  proxyUsername: '',
  proxyPassword: '',
  language: 'zh-CN' as const,
}

function settingsProps() {
  return {
    general,
    systemFonts: ['Arial', 'Microsoft YaHei', 'Segoe UI'],
    themeProfiles: [themeProfile(1, 'dark', '#000000'), themeProfile(2, 'light', '#ffffff')],
    themeAssignments: { dark_profile_id: 1, light_profile_id: 2, follow_interface_mode: true, fixed_profile_id: 0 },
    terminalGlobalStyle: { font_family: 'Global Font', font_size: 16, cursor_style: CursorStyle.CursorStyleUnderline, selection_background: '#264f78' },
    colorMode: 'dark' as const,
    keys: [],
    cloudSync: {
      dashboard: null, loading: false, pending: null, error: null,
      reload: vi.fn(async () => {}), saveConfig: vi.fn(async () => {}), testProvider: vi.fn(async () => {}),
      syncNow: vi.fn(async () => {}), pushNow: vi.fn(async () => {}), pullNow: vi.fn(async () => {}),
      resolveConflict: vi.fn(async () => {}), restoreVersion: vi.fn(async () => {}), deleteVersion: vi.fn(async () => {}), resetLocalData: vi.fn(async () => {}),
    },
    onSaveGeneral: vi.fn(async () => {}),
    onPreviewUIFont: vi.fn(),
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
    onLoadKeyMaterial: vi.fn(async () => undefined),
    onUpdateKey: vi.fn(async () => undefined),
    onSelectKeyImportFile: vi.fn(async () => undefined),
    onExportConfig: vi.fn(),
    onImportConfig: vi.fn(),
    sftpSettings: { showHiddenFiles: false, followTerminalDirectory: false, defaultView: 'list' as const },
    onSaveSFTPSettings: vi.fn(async () => {}),
  }
}

function themeProfile(id: number, mode: 'dark' | 'light', background: string): any {
  return { id, name: mode, theme_id: id, follow_global_style: true, font_family: 'monospace', font_size: 14, cursor_style: 'bar' as const, color_overrides: '{}', created_at: '', updated_at: '', definition: { id, name: mode, mode, source_type: 'builtin' as const, source_name: '', source_url: '', source_author: '', source_license: '', source_version: '', source_fingerprint: mode, color_payload: JSON.stringify({ background, foreground: mode === 'dark' ? '#ffffff' : '#000000', cursor: '#888888', selection: '#264f78', ansi: Array(16).fill('#111111') }), raw_payload: '', is_builtin: true, created_at: '', updated_at: '' } }
}

describe('SettingsView', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('uses the terminal category for terminal theme settings', async () => {
    render(<SettingsView {...settingsProps()} />)

    expect(screen.getByRole('tab', { name: '终端' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'AI' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '外观' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '分组' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '密钥' })).not.toBeInTheDocument()
  })

  it('exposes the SFTP file management settings', async () => {
    const props = settingsProps()
    const user = userEvent.setup()
    render(<SettingsView {...props} />)

    await user.click(screen.getByRole('tab', { name: 'SFTP' }))
    await user.click(screen.getByRole('switch', { name: '显示隐藏文件' }))
    await user.click(screen.getByRole('switch', { name: '追随终端目录' }))
    await user.click(screen.getByRole('button', { name: '树状视图' }))
    await flushAutoSave(user)

    expect(props.onSaveSFTPSettings).toHaveBeenCalledWith({
      showHiddenFiles: true,
      followTerminalDirectory: true,
      defaultView: 'tree',
    })
  })

  it('passes the built-in theme reset action to the terminal editor', async () => {
    const props = settingsProps()
    render(<SettingsView {...props} />)

    await userEvent.click(screen.getByRole('tab', { name: '终端' }))
    expect(screen.getByLabelText('全局终端字体')).toHaveValue('Global Font')
    await userEvent.click(screen.getByRole('button', { name: '重置内置主题' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('全局字体与光标配置不会被修改')
    await userEvent.click(screen.getByRole('button', { name: '确认重置' }))

    expect(props.onResetBuiltinThemes).toHaveBeenCalledOnce()
  })

  it('places appearance cards at the top of general settings', () => {
    render(<SettingsView {...settingsProps()} />)
    const language = screen.getByText('界面语言')
    const font = screen.getByText('界面字体')
    const behavior = screen.getByText('应用行为')
    expect(language.compareDocumentPosition(font) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(font.compareDocumentPosition(behavior) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('最大终端池大小')).not.toBeInTheDocument()
    expect(screen.queryByText('行为')).not.toBeInTheDocument()
  })

  it('previews and saves the selected font settings', async () => {
    const props = settingsProps()
    render(<SettingsView {...props} />)

    expect(screen.getByText(/终端排版请在“终端”分类中配置/)).toBeInTheDocument()

    const fontInput = screen.getByRole('combobox', { name: '界面字体' })
    await userEvent.clear(fontInput)
    await userEvent.type(fontInput, 'YaHei')
    await userEvent.click(await screen.findByRole('option', { name: 'Microsoft YaHei' }))
    await userEvent.clear(screen.getByLabelText('界面字号'))
    await userEvent.type(screen.getByLabelText('界面字号'), '18')

    expect(props.onPreviewUIFont).toHaveBeenLastCalledWith('Microsoft YaHei', 'Segoe UI', 18)
    await flushAutoSave()
    expect(props.onSaveGeneral).toHaveBeenCalledWith(expect.objectContaining({
      uiFontFamily: 'Microsoft YaHei',
      uiFontSize: 18,
      maxPoolSize: 10,
      defaultKeepAlive: 60,
      defaultTermType: 'xterm-256color',
      rightClickAction: 'menu',
      copyOnSelect: false,
    }))
  })

  it('saves changed terminal connection and behavior settings from the terminal tab', async () => {
    const props = settingsProps()
    const user = userEvent.setup()
    render(<SettingsView {...props} />)

    await user.click(screen.getByRole('tab', { name: '终端' }))
    await user.clear(screen.getByRole('spinbutton', { name: '最大终端池大小' }))
    await user.type(screen.getByRole('spinbutton', { name: '最大终端池大小' }), '24')
    await user.clear(screen.getByRole('spinbutton', { name: '默认保活间隔 (秒)' }))
    await user.type(screen.getByRole('spinbutton', { name: '默认保活间隔 (秒)' }), '120')
    await user.click(screen.getByRole('combobox', { name: '默认终端类型' }))
    await user.click(await screen.findByRole('option', { name: 'xterm' }))
    await user.click(screen.getByRole('combobox', { name: '鼠标右键行为' }))
    await user.click(await screen.findByRole('option', { name: '粘贴' }))
    await user.click(screen.getByRole('switch', { name: '选择即复制' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: '滚动历史行数' }), { target: { value: '8000' } })
    await flushAutoSave(user)

    expect(props.onSaveGeneral).toHaveBeenCalledWith(expect.objectContaining({
      maxPoolSize: 24,
      defaultKeepAlive: 120,
      defaultTermType: 'xterm',
      rightClickAction: 'paste',
      copyOnSelect: true,
      scrollbackLines: 8000,
    }))
  })

  it('saves the selected close button behavior', async () => {
    const props = settingsProps()
    const user = userEvent.setup()
    render(<SettingsView {...props} />)

    await user.click(screen.getByRole('combobox', { name: '关闭按钮行为' }))
    await user.click(await screen.findByRole('option', { name: '关闭应用' }))
    await flushAutoSave(user)

    expect(props.onSaveGeneral).toHaveBeenCalledWith(expect.objectContaining({ closeButtonAction: 'exit' as const, language: 'zh-CN' as const }))
  })

  it('previews and saves a distinct fallback font', async () => {
    const props = settingsProps()
    render(<SettingsView {...props} />)

    const fallbackInput = screen.getByRole('combobox', { name: 'Fallback 字体' })
    await userEvent.clear(fallbackInput)
    await userEvent.type(fallbackInput, 'YaHei')
    await userEvent.click(await screen.findByRole('option', { name: 'Microsoft YaHei' }))

    expect(props.onPreviewUIFont).toHaveBeenLastCalledWith('Arial', 'Microsoft YaHei', 14)
    await flushAutoSave()
    expect(props.onSaveGeneral).toHaveBeenCalledWith(expect.objectContaining({ uiFontFallbackFamily: 'Microsoft YaHei' }))
  })

  it('resets fallback when the primary font selects the same family', async () => {
    const props = settingsProps()
    render(<SettingsView {...props} />)

    const fontInput = screen.getByRole('combobox', { name: '界面字体' })
    await userEvent.clear(fontInput)
    await userEvent.type(fontInput, 'Segoe')
    await userEvent.click(await screen.findByRole('option', { name: 'Segoe UI' }))

    expect(props.onPreviewUIFont).toHaveBeenLastCalledWith('Segoe UI', 'sans-serif', 14)
  })
})

async function flushAutoSave(user?: ReturnType<typeof userEvent.setup>) {
  await vi.advanceTimersByTimeAsync(600)
  await Promise.resolve()
  if (user) await Promise.resolve()
}
