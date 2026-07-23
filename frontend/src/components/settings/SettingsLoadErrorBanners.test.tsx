import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GeneralSettingsPanel } from '@/components/settings/GeneralSettingsPanel'
import { SFTPSettingsPanel } from '@/components/settings/SFTPSettingsPanel'
import { TerminalSettingsPanel } from '@/components/settings/TerminalSettingsPanel'
import type { GeneralSettings } from '@/hooks/useGeneralSettings'
import { DEFAULT_SFTP_SETTINGS } from '@/lib/sftpSettings'
import { CursorStyle } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

const general: GeneralSettings = {
  maxPoolSize: 10, defaultKeepAlive: 60, defaultTermType: 'xterm-256color',
  uiFontFamily: 'sans-serif', uiFontFallbackFamily: 'sans-serif', uiFontSize: 14,
  rightClickAction: 'menu', copyOnSelect: false, scrollbackLines: 10000, autoReconnect: false,
  restoreTabsOnStartup: true, renderer: 'dom', historyPredict: false,
  localShell: '', localShellArgs: '', localShellCwd: '', localShellLogin: true,
  closeButtonAction: 'tray', logDir: '', logRetentionDays: 30,
  proxyMode: 'system', proxyURL: '', proxyNoProxy: '', proxyUsername: '',
  proxyPassword: '', proxyPasswordSaved: false, clearProxyPassword: false, language: 'zh-CN',
}

const profile = {
  id: 1,
  name: 'dark',
  theme_id: 1,
  follow_global_style: true,
  font_family: 'monospace',
  font_size: 14,
  cursor_style: 'bar',
  color_overrides: '{}',
  created_at: '',
  updated_at: '',
  definition: {
    id: 1, name: 'dark', mode: 'dark', source_type: 'builtin', source_name: '', source_url: '',
    source_author: '', source_license: '', source_version: '', source_fingerprint: 'dark',
    color_payload: JSON.stringify({ background: '#000', foreground: '#fff', cursor: '#888', selection: '#264f78', ansi: Array(16).fill('#111') }),
    raw_payload: '', is_builtin: true, created_at: '', updated_at: '',
  },
}

describe('settings load error banners', () => {
  it('shows general settings load error and retry', () => {
    const onReload = vi.fn()
    render(
      <GeneralSettingsPanel
        general={general}
        systemFonts={['sans-serif']}
        onSave={async () => undefined}
        onPreviewUIFont={() => undefined}
        settingsReady={false}
        loadError="settings unavailable"
        onReload={onReload}
      />,
    )
    expect(screen.getByText(/加载设置失败/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(onReload).toHaveBeenCalled()
  })

  it('shows SFTP settings load error and retry', () => {
    const onReload = vi.fn()
    render(
      <SFTPSettingsPanel
        settings={DEFAULT_SFTP_SETTINGS}
        onSave={async () => undefined}
        settingsReady={false}
        loadError="sftp boom"
        onReload={onReload}
      />,
    )
    expect(screen.getByText(/加载 SFTP 设置失败/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(onReload).toHaveBeenCalled()
  })

  it('shows theme catalog load error and retry', () => {
    const onReloadThemes = vi.fn()
    render(
      <TerminalSettingsPanel
        general={general}
        themeProfiles={[profile as never]}
        themeAssignments={{ dark_profile_id: 1, light_profile_id: 1, follow_interface_mode: true, fixed_profile_id: 0 }}
        terminalGlobalStyle={{ font_family: 'mono', font_size: 14, cursor_style: CursorStyle.CursorStyleBar, selection_background: '#264f78' }}
        colorMode="dark"
        onSaveGeneral={async () => undefined}
        onSaveThemeConfiguration={async () => undefined}
        onImportThemes={async () => ({ imported: 0, skipped: 0, failed: 0, results: [] })}
        onCreateThemeProfile={async () => null}
        onUpdateThemeProfile={async () => undefined}
        onDeleteThemeProfile={async () => undefined}
        onDeleteThemeDefinition={async () => undefined}
        onResetBuiltinThemes={async () => ({ dark_reset: false, light_reset: false, fixed_reset: false })}
        themeLoadError="theme catalog down"
        onReloadThemes={onReloadThemes}
      />,
    )
    expect(screen.getByText(/加载主题失败/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(onReloadThemes).toHaveBeenCalled()
  })
})
