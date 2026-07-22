import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Events } from '@wailsio/runtime'
import { useGeneralSettings } from '@/hooks/useGeneralSettings'
import { useAppStore } from '@/store/appStore'
import { __clearHandlers, __emitEvent, __registerHandler } from '@/test/__mocks__/wails-runtime'
import { SETTINGS_GENERAL_CHANGED_EVENT, SETTINGS_GENERAL_PREVIEW_EVENT, SETTINGS_PREVIEW_CANCELLED_EVENT } from '@/lib/settingsWindowEvents'

const savedGeneral = {
  maxPoolSize: 24, defaultKeepAlive: 90, defaultTermType: 'xterm',
  uiFontFamily: 'Arial', uiFontFallbackFamily: 'Segoe UI', uiFontSize: 18,
  rightClickAction: 'paste' as const, copyOnSelect: true, scrollbackLines: 10000, autoReconnect: false, restoreTabsOnStartup: true, renderer: 'dom' as const,
  closeButtonAction: 'exit' as const,
  logDir: '/tmp/mssh-logs',
  logRetentionDays: 14,
  proxyMode: 'system' as const,
  proxyURL: '',
  proxyNoProxy: '',
  proxyUsername: '',
  proxyPassword: '',
  language: 'zh-CN' as const,
}

describe('useGeneralSettings cross-window sync', () => {
  let maxPoolSize = 10

  beforeEach(() => {
    __clearHandlers()
    maxPoolSize = 10
    document.documentElement.style.removeProperty('--app-font-family')
    document.documentElement.style.removeProperty('--app-font-size')
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async () => ({
      'terminal.max_pool_size': setting('terminal.max_pool_size', maxPoolSize),
    }))
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetMany', async () => {})
    __registerHandler('github.com/xuthus5/mssh/internal/service.TerminalService.SetMaxSize', async () => {})
  })

  it('applies preview values emitted by another window', async () => {
    renderHook(() => useGeneralSettings())
    await act(async () => {})
    act(() => __emitEvent(SETTINGS_GENERAL_PREVIEW_EVENT, { data: {
      uiFontFamily: 'Microsoft YaHei', uiFontFallbackFamily: 'Segoe UI', uiFontSize: 20,
    } }))
    expect(document.documentElement.style.getPropertyValue('--app-font-size')).toBe('20px')
  })

  it('broadcasts local font previews without a transparency preview', async () => {
    const previews: unknown[] = []
    const stop = Events.On(SETTINGS_GENERAL_PREVIEW_EVENT, (event) => previews.push(event.data))
    const { result } = renderHook(() => useGeneralSettings())
    await act(async () => {})
    act(() => {
      result.current.previewUIFont('Arial', 'Segoe UI', 19)
    })
    expect(previews).toContainEqual({ uiFontFamily: 'Arial', uiFontFallbackFamily: 'Segoe UI', uiFontSize: 19 })
    expect(previews).toHaveLength(1)
    stop()
  })

  it('applies committed settings and updates runtime limits', async () => {
    const { result } = renderHook(() => useGeneralSettings())
    await act(async () => {})
    act(() => __emitEvent(SETTINGS_GENERAL_CHANGED_EVENT, { data: savedGeneral }))
    expect(result.current.general).toEqual(savedGeneral)
    expect(useAppStore.getState().maxPoolSize).toBe(24)
  })

  it('reloads persisted settings after preview cancellation', async () => {
    const { result } = renderHook(() => useGeneralSettings())
    await act(async () => {})
    maxPoolSize = 33
    act(() => __emitEvent(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }))
    await waitFor(() => expect(result.current.general.maxPoolSize).toBe(33))
  })

  it('broadcasts normalized settings after a successful save', async () => {
    const received: unknown[] = []
    const stop = Events.On(SETTINGS_GENERAL_CHANGED_EVENT, (event) => received.push(event.data))
    const { result } = renderHook(() => useGeneralSettings())
    await act(async () => { await result.current.saveGeneral(savedGeneral) })
    expect(received).toContainEqual(savedGeneral)
    stop()
  })

  it('defaults the close button action to the system tray', async () => {
    const { result } = renderHook(() => useGeneralSettings())
    await waitFor(() => expect(result.current.general.closeButtonAction).toBe('tray'))
  })

  it('loads and persists the close button action using the final setting contract', async () => {
    let savedEntries: Array<{ key: string; value: string }> = []
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async () => ({
      'application.close_button_action': setting('application.close_button_action', 'exit'),
    }))
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetMany', async (entries) => { savedEntries = entries })
    const { result } = renderHook(() => useGeneralSettings())
    await waitFor(() => expect(result.current.general.closeButtonAction).toBe('exit'))

    await act(async () => { await result.current.saveGeneral({ ...savedGeneral, closeButtonAction: 'tray', language: 'zh-CN' }) })

    expect(savedEntries).toContainEqual(expect.objectContaining({
      key: 'application.close_button_action', value: '"tray"',
    }))
  })

  it('loads and persists application log settings', async () => {
    let savedEntries: Array<{ key: string; value: string }> = []
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async () => ({
      'application.log_dir': setting('application.log_dir', '/var/log/mssh'),
      'application.log_retention_days': setting('application.log_retention_days', 45),
    }))
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetMany', async (entries) => { savedEntries = entries })
    const { result } = renderHook(() => useGeneralSettings())
    await waitFor(() => expect(result.current.general.logDir).toBe('/var/log/mssh'))
    await waitFor(() => expect(result.current.general.logRetentionDays).toBe(45))
    await act(async () => {
      await result.current.saveGeneral({ ...savedGeneral, logDir: ' /data/logs ', logRetentionDays: 99999 })
    })
    expect(savedEntries).toContainEqual(expect.objectContaining({ key: 'application.log_dir', value: '"/data/logs"' }))
    expect(savedEntries).toContainEqual(expect.objectContaining({ key: 'application.log_retention_days', value: '3650' }))
    expect(result.current.general.logRetentionDays).toBe(3650)
  })

  it('loads and persists network proxy settings', async () => {
    let savedEntries: Array<{ key: string; value: string }> = []
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async () => ({
      'application.proxy_mode': setting('application.proxy_mode', 'manual'),
      'application.proxy_url': setting('application.proxy_url', 'http://127.0.0.1:1080'),
      'application.proxy_no_proxy': setting('application.proxy_no_proxy', 'localhost'),
    }))
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetMany', async (entries) => { savedEntries = entries })
    const { result } = renderHook(() => useGeneralSettings())
    await waitFor(() => expect(result.current.general.proxyMode).toBe('manual'))
    await waitFor(() => expect(result.current.general.proxyURL).toBe('http://127.0.0.1:1080'))
    await act(async () => {
      await result.current.saveGeneral({
        ...savedGeneral,
        proxyMode: 'manual',
        proxyURL: ' http://127.0.0.1:7890 ',
        proxyNoProxy: ' 127.0.0.1 ',
        proxyUsername: ' u ',
        proxyPassword: 'secret',
      })
    })
    expect(savedEntries).toContainEqual(expect.objectContaining({ key: 'application.proxy_mode', value: '"manual"' }))
    expect(savedEntries).toContainEqual(expect.objectContaining({ key: 'application.proxy_url', value: '"http://127.0.0.1:7890"' }))
    expect(savedEntries).toContainEqual(expect.objectContaining({ key: 'application.proxy_no_proxy', value: '"127.0.0.1"' }))
    expect(result.current.general.proxyURL).toBe('http://127.0.0.1:7890')
  })

  it('loads and persists terminal scrollback lines with clamping', async () => {
    let savedEntries: Array<{ key: string; value: string }> = []
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async () => ({
      'terminal.scrollback_lines': setting('terminal.scrollback_lines', 2500),
    }))
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetMany', async (entries) => { savedEntries = entries })
    const { result } = renderHook(() => useGeneralSettings())
    await waitFor(() => expect(result.current.general.scrollbackLines).toBe(2500))

    await act(async () => {
      await result.current.saveGeneral({ ...savedGeneral, scrollbackLines: 999999 })
    })
    expect(savedEntries).toContainEqual(expect.objectContaining({
      key: 'terminal.scrollback_lines', value: '100000',
    }))
    expect(result.current.general.scrollbackLines).toBe(100000)
  })
})

function setting(key: string, value: unknown) {
  return { key, namespace: key.split('.')[0], value: JSON.stringify(value), value_type: typeof value, version: 1, updated_at: '' }
}

  it('loads and persists auto reconnect and restore tabs preferences', async () => {
    const setMany = vi.fn(async () => {})
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async () => ({
      'terminal.auto_reconnect': setting('terminal.auto_reconnect', true),
      'terminal.restore_tabs_on_startup': setting('terminal.restore_tabs_on_startup', false),
    }))
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetMany', setMany)
    __registerHandler('github.com/xuthus5/mssh/internal/service.TerminalService.SetMaxSize', async () => {})
    const { result } = renderHook(() => useGeneralSettings())
    await waitFor(() => expect(result.current.general.autoReconnect).toBe(true))
    expect(result.current.general.restoreTabsOnStartup).toBe(false)
    await act(async () => {
      await result.current.saveGeneral({ ...savedGeneral, autoReconnect: true, restoreTabsOnStartup: false })
    })
    expect(setMany).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ key: 'terminal.auto_reconnect', value: 'true' }),
      expect.objectContaining({ key: 'terminal.restore_tabs_on_startup', value: 'false' }),
    ]))
  })

  it('loads and persists terminal renderer preference', async () => {
    const setMany = vi.fn(async () => {})
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async () => ({
      'terminal.renderer': setting('terminal.renderer', 'webgl'),
    }))
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetMany', setMany)
    __registerHandler('github.com/xuthus5/mssh/internal/service.TerminalService.SetMaxSize', async () => {})
    const { result } = renderHook(() => useGeneralSettings())
    await waitFor(() => expect(result.current.general.renderer).toBe('webgl'))
    await act(async () => {
      await result.current.saveGeneral({ ...savedGeneral, renderer: 'canvas' })
    })
    const payload = (setMany.mock.calls.at(-1) ?? []) as unknown[]
    const entries = (Array.isArray(payload[0]) ? payload[0] : []) as Array<{ key: string; value: string }>
    const rendererEntry = entries.find((entry) => entry.key === 'terminal.renderer')
    expect(rendererEntry?.value).toBe(JSON.stringify('canvas'))
    expect(result.current.general.renderer).toBe('canvas')
  })

