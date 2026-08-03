import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Events } from '@wailsio/runtime'
import { SettingsView } from '@/components/settings/SettingsView'
import { useToastStore } from '@/components/ui/toast'
import type { GeneralSettings } from '@/hooks/useSettings'
import { SETTINGS_PREVIEW_CANCELLED_EVENT } from '@/lib/settingsWindowEvents'
import { CursorStyle } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

const general: GeneralSettings = {
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
  localShell: '',
  localShellArgs: '',
  localShellCwd: '',
  localShellLogin: true,
  keywordHighlightEnabled: true,
  keywordHighlightCaseInsensitive: true,
  keywordHighlightRules: [{ keyword: 'Error', color: '#ff5555' }],
  closeButtonAction: 'tray' as const,
  debug: false,
  logDir: '',
  logRetentionDays: 30,
  proxyMode: 'system' as const,
  proxyURL: '',
  proxyNoProxy: '',
  proxyUsername: '',
  proxyPassword: '',
  proxyPasswordSaved: false,
  clearProxyPassword: false,
  language: 'zh-CN' as const,
}

function settingsProps() {
  return {
    general,
    systemFonts: ['Arial', 'Microsoft YaHei', 'Segoe UI'],
    themeProfiles: [themeProfile(1, 'dark', '#000000'), themeProfile(2, 'light', '#ffffff')],
    themeAssignments: { dark_profile_id: 1, light_profile_id: 2, follow_interface_mode: true, fixed_profile_id: 0 },
    terminalGlobalStyle: { font_family: 'Global Font', font_size: 16, cursor_style: CursorStyle.CursorStyleUnderline, selection_background: '#264f78', ligatures_enabled: false },
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
    useToastStore.setState({ toasts: [] })
  })
  afterEach(() => {
    vi.clearAllTimers()
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

  it('lazily mounts settings panels and keeps visited panels mounted', async () => {
    render(<SettingsView {...settingsProps()} />)

    expect(screen.getAllByRole('tabpanel', { hidden: true })).toHaveLength(1)
    await userEvent.click(screen.getByRole('tab', { name: '终端' }))
    expect(screen.getAllByRole('tabpanel', { hidden: true })).toHaveLength(2)
    await userEvent.click(screen.getByRole('tab', { name: '通用' }))
    expect(screen.getAllByRole('tabpanel', { hidden: true })).toHaveLength(2)
  })

  it('exposes the SFTP file management settings', async () => {
    const props = settingsProps()
    const user = userEvent.setup()
    render(<SettingsView {...props} />)

    await user.click(screen.getByRole('tab', { name: 'SFTP' }))
    expect(screen.getByText(/开启后.*\.bashrc.*\.zshrc/)).toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: '显示隐藏文件' }))
    await user.click(screen.getByRole('switch', { name: '追随终端目录' }))
    await user.click(screen.getByRole('button', { name: '树状视图' }))
    await flushAutoSave()

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
    }), { scope: 'general' })
  })

  it('saves changed terminal connection settings from the terminal tab', async () => {
    const props = settingsProps()
    const user = userEvent.setup()
    render(<SettingsView {...props} />)

    await user.click(screen.getByRole('tab', { name: '终端' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: '最大终端池大小' }), { target: { value: '24' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: '默认保活间隔 (秒)' }), { target: { value: '120' } })
    await user.click(screen.getByRole('combobox', { name: '默认终端类型' }))
    await user.click(await screen.findByRole('option', { name: 'xterm' }))
    await flushAutoSave()

    expect(props.onSaveGeneral).toHaveBeenCalledWith(expect.objectContaining({
      maxPoolSize: 24,
      defaultKeepAlive: 120,
      defaultTermType: 'xterm',
    }), { scope: 'terminal' })
  })

  it('saves changed terminal behavior settings from the terminal tab', async () => {
    const props = settingsProps()
    const user = userEvent.setup()
    render(<SettingsView {...props} />)

    await user.click(screen.getByRole('tab', { name: '终端' }))
    await user.click(screen.getByRole('combobox', { name: '鼠标右键行为' }))
    await user.click(await screen.findByRole('option', { name: '粘贴' }))
    fireEvent.click(screen.getByRole('switch', { name: '选择即复制' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: '滚动历史行数' }), { target: { value: '8000' } })
    await flushAutoSave()

    expect(props.onSaveGeneral).toHaveBeenCalledWith(expect.objectContaining({
      rightClickAction: 'paste',
      copyOnSelect: true,
      scrollbackLines: 8000,
    }), { scope: 'terminal' })
  })

  it('saves the selected close button behavior', async () => {
    const props = settingsProps()
    const user = userEvent.setup()
    render(<SettingsView {...props} />)

    await user.click(screen.getByRole('combobox', { name: '关闭按钮行为' }))
    await user.click(await screen.findByRole('option', { name: '关闭应用' }))
    await flushAutoSave()

    expect(props.onSaveGeneral).toHaveBeenCalledWith(expect.objectContaining({ closeButtonAction: 'exit' as const, language: 'zh-CN' as const }), { scope: 'general' })
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
    expect(props.onSaveGeneral).toHaveBeenCalledWith(expect.objectContaining({ uiFontFallbackFamily: 'Microsoft YaHei' }), { scope: 'general' })
  })

  it('resets fallback when the primary font selects the same family', async () => {
    const props = settingsProps()
    render(<SettingsView {...props} />)

    const fontInput = screen.getByRole('combobox', { name: '界面字体' })
    await userEvent.clear(fontInput)
    await userEvent.type(fontInput, 'Segoe')
    await userEvent.click(await screen.findByRole('option', { name: 'Segoe UI' }))

    expect(props.onPreviewUIFont).toHaveBeenLastCalledWith('Segoe UI', 'sans-serif', 14)
    await flushAutoSave()
  })

  it('flushes pending general changes before switching categories', async () => {
    const props = settingsProps()
    render(<SettingsView {...props} />)

    fireEvent.change(screen.getByLabelText('日志保留天数'), { target: { value: '45' } })
    expect(props.onSaveGeneral).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('tab', { name: '终端' }))
    await flushAutoSave()

    expect(props.onSaveGeneral).toHaveBeenCalledWith(expect.objectContaining({ logRetentionDays: 45 }), { scope: 'general' })
  })

  it('keeps a failed general draft and its error after switching categories', async () => {
    const props = settingsProps()
    props.onSaveGeneral = vi.fn().mockRejectedValue(new Error('disk full'))
    render(<SettingsView {...props} />)

    fireEvent.change(screen.getByLabelText('日志保留天数'), { target: { value: '45' } })
    await userEvent.click(screen.getByRole('tab', { name: '终端' }))
    await advanceTimers(500)
    await userEvent.click(screen.getByRole('tab', { name: '通用' }))

    expect(props.onSaveGeneral).toHaveBeenCalledWith(expect.objectContaining({ logRetentionDays: 45 }), { scope: 'general' })
    expect(screen.getByLabelText('日志保留天数')).toHaveValue(45)
    expect(useToastStore.getState().toasts.some((item) => item.type === 'error' && item.message.includes('自动保存失败: disk full'))).toBe(true)
  })

  it('keeps a newer general draft when an earlier save response arrives', async () => {
    const firstSave = deferredSave()
    const props = settingsProps()
    props.onSaveGeneral = vi.fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockResolvedValue(undefined)
    const view = render(<SettingsView {...props} />)

    fireEvent.change(screen.getByLabelText('界面字号'), { target: { value: '15' } })
    await advanceTimers(450)
    fireEvent.change(screen.getByLabelText('界面字号'), { target: { value: '16' } })
    await act(async () => {
      firstSave.resolve()
      await firstSave.promise
      await Promise.resolve()
    })
    view.rerender(<SettingsView {...props} general={{ ...general, uiFontSize: 15 }} />)

    expect(screen.getByLabelText('界面字号')).toHaveValue(16)
    await advanceTimers(450)
    expect(props.onSaveGeneral).toHaveBeenLastCalledWith(expect.objectContaining({ uiFontSize: 16 }), { scope: 'general' })
  })

  it('clears a saved proxy password without writing it twice', async () => {
    const save = deferredSave()
    const props = settingsProps()
    props.general = { ...general, proxyMode: 'manual' }
    props.onSaveGeneral = vi.fn(() => save.promise)
    const view = render(<SettingsView {...props} />)

    await userEvent.type(screen.getByLabelText('代理密码'), 'proxy-secret')
    await advanceTimers(450)
    view.rerender(<SettingsView {...props} general={{
      ...props.general,
      proxyPasswordSaved: true,
    }} />)
    await act(async () => {
      save.resolve()
      await save.promise
      await Promise.resolve()
    })

    expect(screen.getByLabelText('代理密码')).toHaveValue('')
    await advanceTimers(600)
    expect(props.onSaveGeneral).toHaveBeenCalledOnce()
  })

  it('redacts a pending proxy password when the native settings window hides without writing it twice', async () => {
    const save = deferredSave()
    const props = settingsProps()
    props.general = { ...general, proxyMode: 'manual' }
    props.onSaveGeneral = vi.fn(() => save.promise)
    render(<SettingsView {...props} />)
    await userEvent.type(screen.getByLabelText('代理密码'), 'proxy-secret')

    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })

    expect(props.onSaveGeneral).toHaveBeenCalledOnce()
    expect(props.onSaveGeneral).toHaveBeenCalledWith(expect.objectContaining({ proxyPassword: 'proxy-secret' }), { scope: 'general' })
    expect(screen.getByLabelText('代理密码')).toHaveValue('')
    await act(async () => { save.resolve(); await save.promise; await Promise.resolve() })
    await advanceTimers(600)
    expect(props.onSaveGeneral).toHaveBeenCalledOnce()
  })
})

async function flushAutoSave() {
  await advanceTimers(600)
}

async function advanceTimers(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds)
    await Promise.resolve()
  })
}

function deferredSave() {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
