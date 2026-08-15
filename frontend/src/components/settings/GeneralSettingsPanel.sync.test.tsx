import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GeneralSettingsPanel } from '@/components/settings/GeneralSettingsPanel'
import type { GeneralSettings } from '@/hooks/useGeneralSettings'

const initialSettings: GeneralSettings = {
  maxPoolSize: 10,
  defaultKeepAlive: 60,
  defaultTermType: 'xterm-256color',
  uiFontFamily: 'Old Font',
  uiFontFallbackFamily: 'sans-serif',
  uiFontSize: 14,
  rightClickAction: 'menu',
  copyOnSelect: false,
  scrollbackLines: 10000,
  autoReconnect: false,
  restoreTabsOnStartup: true,
  renderer: 'dom',
  historyPredict: false, autoCloseTerminalOnExit: false,
  localShell: '',
  localShellArgs: '',
  localShellCwd: '',
  localShellLogin: true,
keywordHighlightEnabled: true,
  keywordHighlightCaseInsensitive: true,
  keywordHighlightRules: [{ keyword: 'Error', color: '#ff5555' }],
  closeButtonAction: 'tray',
  debug: false,
  logDir: '/old/logs',
  logRetentionDays: 30,
  proxyMode: 'manual',
  proxyURL: 'http://old.proxy:1080',
  proxyNoProxy: '',
  proxyUsername: 'old-user',
  proxyPassword: '',
  proxyPasswordSaved: true,
  clearProxyPassword: false,
  language: 'zh-CN',
}

describe('GeneralSettingsPanel synchronized drafts', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('saves a later edit on top of the synchronized settings snapshot', async () => {
    const onSave = vi.fn(async () => {})
    const synchronized = {
      ...initialSettings,
      uiFontFamily: 'Synced Font',
      closeButtonAction: 'exit' as const,
      logDir: '/synced/logs',
      logRetentionDays: 45,
      proxyURL: 'http://synced.proxy:7890',
      proxyUsername: 'synced-user',
    }
    const view = render(
      <GeneralSettingsPanel
        general={initialSettings}
        systemFonts={['Old Font', 'Synced Font']}
        onSave={onSave}
        onPreviewUIFont={() => undefined}
      />,
    )

    view.rerender(
      <GeneralSettingsPanel
        general={synchronized}
        systemFonts={['Old Font', 'Synced Font']}
        onSave={onSave}
        onPreviewUIFont={() => undefined}
      />,
    )
    fireEvent.change(screen.getByLabelText('界面字号'), { target: { value: '19' } })
    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      uiFontFamily: 'Synced Font',
      uiFontSize: 19,
      closeButtonAction: 'exit',
      logDir: '/synced/logs',
      logRetentionDays: 45,
      proxyURL: 'http://synced.proxy:7890',
      proxyUsername: 'synced-user',
    }), { scope: 'general' })
  })
})
