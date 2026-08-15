import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Events } from '@wailsio/runtime'
import { resolveProxyPasswordWrite, useGeneralSettings } from '@/hooks/useGeneralSettings'
import { useAppStore } from '@/store/appStore'
import { __clearHandlers, __emitEvent, __registerHandler } from '@/test/__mocks__/wails-runtime'
import { SETTINGS_GENERAL_CHANGED_EVENT, SETTINGS_GENERAL_PREVIEW_EVENT, SETTINGS_PREVIEW_CANCELLED_EVENT } from '@/lib/settingsWindowEvents'
import { syncDataChangedEvent } from '@/lib/syncDataReload'

function setting(key: string, value: unknown) {
  return { key, namespace: key.split('.')[0], value: JSON.stringify(value), value_type: typeof value, version: 1, updated_at: '' }
}

const savedGeneral = {
  maxPoolSize: 24, defaultKeepAlive: 90, defaultTermType: 'xterm',
  uiFontFamily: 'Arial', uiFontFallbackFamily: 'Segoe UI', uiFontSize: 18,
  rightClickAction: 'paste' as const, copyOnSelect: true, scrollbackLines: 10000, autoReconnect: false, restoreTabsOnStartup: true, renderer: 'dom' as const,
  historyPredict: false, autoCloseTerminalOnExit: false,
  localShell: '', localShellArgs: '', localShellCwd: '', localShellLogin: true,
  keywordHighlightEnabled: true, keywordHighlightCaseInsensitive: true, keywordHighlightRules: [{ keyword: 'Error', color: '#ff5555' }],
  closeButtonAction: 'exit' as const,
  debug: false,
  logDir: '/tmp/mssh-logs',
  logRetentionDays: 14,
  proxyMode: 'system' as const,
  proxyURL: '',
  proxyNoProxy: '',
  proxyUsername: '',
  proxyPassword: '', proxyPasswordSaved: false, clearProxyPassword: false,
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

  it('reloads persisted settings after synchronized data changes', async () => {
    let synchronized = false
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async () => synchronized ? {
      'terminal.max_pool_size': setting('terminal.max_pool_size', 24),
      'appearance.ui_font_family': setting('appearance.ui_font_family', 'Synced Font'),
      'application.log_dir': setting('application.log_dir', '/synced/logs'),
    } : {
      'terminal.max_pool_size': setting('terminal.max_pool_size', 10),
      'appearance.ui_font_family': setting('appearance.ui_font_family', 'Old Font'),
      'application.log_dir': setting('application.log_dir', '/old/logs'),
    })
    const { result } = renderHook(() => useGeneralSettings())
    await waitFor(() => expect(result.current.general.uiFontFamily).toBe('Old Font'))

    synchronized = true
    act(() => __emitEvent(syncDataChangedEvent, { data: { changed: true } }))

    await waitFor(() => expect(result.current.general).toMatchObject({
      maxPoolSize: 24,
      uiFontFamily: 'Synced Font',
      logDir: '/synced/logs',
    }))
  })

  it('keeps a newer cross-window update when the initial load resolves later', async () => {
    const initialLoad = deferred<Record<string, unknown>>()
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async () => initialLoad.promise)
    const { result } = renderHook(() => useGeneralSettings())

    await waitFor(() => expect(result.current.settingsReady).toBe(false))
    act(() => __emitEvent(SETTINGS_GENERAL_CHANGED_EVENT, { data: savedGeneral }))
    expect(result.current.general.maxPoolSize).toBe(24)

    await act(async () => {
      initialLoad.resolve({ 'terminal.max_pool_size': setting('terminal.max_pool_size', 11) })
      await initialLoad.promise
    })

    expect(result.current.general.maxPoolSize).toBe(24)
  })

  it('reapplies the newest pool limit after a stale load update finishes', async () => {
    const stalePoolUpdate = deferred<void>()
    const setMaxSize = vi.fn(async (size: number) => {
      if (size === 11) await stalePoolUpdate.promise
    })
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async () => ({
      'terminal.max_pool_size': setting('terminal.max_pool_size', 11),
    }))
    __registerHandler('github.com/xuthus5/mssh/internal/service.TerminalService.SetMaxSize', setMaxSize)
    const { result } = renderHook(() => useGeneralSettings())
    await waitFor(() => expect(setMaxSize).toHaveBeenCalledWith(11))

    act(() => __emitEvent(SETTINGS_GENERAL_CHANGED_EVENT, { data: savedGeneral }))
    expect(result.current.general.maxPoolSize).toBe(24)

    await act(async () => {
      stalePoolUpdate.resolve(undefined)
      await stalePoolUpdate.promise
    })

    await waitFor(() => expect(setMaxSize).toHaveBeenLastCalledWith(24))
  })

  it('applies the persisted terminal pool limit to the backend during load', async () => {
    const setMaxSize = vi.fn(async () => {})
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async () => ({
      'terminal.max_pool_size': setting('terminal.max_pool_size', 22),
    }))
    __registerHandler('github.com/xuthus5/mssh/internal/service.TerminalService.SetMaxSize', setMaxSize)

    const { result } = renderHook(() => useGeneralSettings())
    await waitFor(() => expect(result.current.settingsReady).toBe(true))

    expect(setMaxSize).toHaveBeenCalledWith(22)
  })

  it('does not update the backend pool limit when settings persistence fails', async () => {
    const setMaxSize = vi.fn(async () => {})
    __registerHandler('github.com/xuthus5/mssh/internal/service.TerminalService.SetMaxSize', setMaxSize)
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetMany', async () => {
      throw new Error('settings write failed')
    })
    const { result } = renderHook(() => useGeneralSettings())
    await waitFor(() => expect(result.current.settingsReady).toBe(true))
    const callsAfterLoad = setMaxSize.mock.calls.length

    await expect(result.current.saveGeneral({ ...result.current.general, maxPoolSize: 18 })).rejects.toThrow('settings write failed')

    expect(setMaxSize).toHaveBeenCalledTimes(callsAfterLoad)
  })

  it('reloads persisted settings after preview cancellation', async () => {
    const { result } = renderHook(() => useGeneralSettings())
    await act(async () => {})
    maxPoolSize = 33
    act(() => __emitEvent(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }))
    await waitFor(() => expect(result.current.general.maxPoolSize).toBe(33))
  })

  it('keeps the newest general settings when reloads resolve out of order', async () => {
    const first = deferred<Record<string, unknown>>()
    const second = deferred<Record<string, unknown>>()
    let loads = 0
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async () => {
      loads++
      return loads === 1 ? first.promise : second.promise
    })
    const { result } = renderHook(() => useGeneralSettings())
    await waitFor(() => expect(loads).toBe(1))
    let latestReload!: Promise<void>
    act(() => { latestReload = result.current.reloadGeneral() })
    await waitFor(() => expect(loads).toBe(2))

    await act(async () => { second.resolve({ 'terminal.max_pool_size': setting('terminal.max_pool_size', 22) }); await latestReload })
    expect(result.current.general.maxPoolSize).toBe(22)
    await act(async () => { first.resolve({ 'terminal.max_pool_size': setting('terminal.max_pool_size', 11) }); await first.promise })
    expect(result.current.general.maxPoolSize).toBe(22)
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

  it('defaults the no-proxy list to common private network hosts', async () => {
    const { result } = renderHook(() => useGeneralSettings())
    await waitFor(() => expect(result.current.general.proxyNoProxy).toContain('172.16.*'))
    expect(result.current.general.proxyNoProxy).toContain('localhost')
    expect(result.current.general.proxyNoProxy).toContain('.internal')
  })

  it('loads and persists the application debug setting', async () => {
    let savedEntries: Array<{ key: string; value: string }> = []
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async () => ({
      'application.debug': setting('application.debug', true),
    }))
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetMany', async (entries) => { savedEntries = entries })
    const { result } = renderHook(() => useGeneralSettings())
    await waitFor(() => expect(result.current.general.debug).toBe(true))

    await act(async () => {
      await result.current.saveGeneral({ ...savedGeneral, debug: false })
    })

    expect(savedEntries).toContainEqual(expect.objectContaining({
      key: 'application.debug', value: 'false',
    }))
    expect(result.current.general.debug).toBe(false)
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
        proxyPassword: 'secret', proxyPasswordSaved: false, clearProxyPassword: false,
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

  it('loads and persists history predict preference', async () => {
    const setMany = vi.fn(async () => {})
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async () => ({
      'terminal.history_predict': setting('terminal.history_predict', true),
    }))
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetMany', setMany)
    __registerHandler('github.com/xuthus5/mssh/internal/service.TerminalService.SetMaxSize', async () => {})
    const { result } = renderHook(() => useGeneralSettings())
    await waitFor(() => expect(result.current.general.historyPredict).toBe(true))
    await act(async () => {
      await result.current.saveGeneral({ ...savedGeneral, historyPredict: true })
    })
    expect(setMany).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ key: 'terminal.history_predict', value: 'true' }),
    ]))
  })

  it('loads and persists local shell preference', async () => {
    let savedEntries: Array<{ key: string; value: string }> = []
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async () => ({
      'terminal.local_shell': setting('terminal.local_shell', '/bin/zsh'),
      'terminal.local_shell_args': setting('terminal.local_shell_args', '-i'),
      'terminal.local_shell_cwd': setting('terminal.local_shell_cwd', '/tmp'),
      'terminal.local_shell_login': setting('terminal.local_shell_login', false),
    }))
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetMany', async (entries) => { savedEntries = entries })
    const { result } = renderHook(() => useGeneralSettings())
    await waitFor(() => expect(result.current.general.localShell).toBe('/bin/zsh'))
    expect(result.current.general.localShellArgs).toBe('-i')
    expect(result.current.general.localShellCwd).toBe('/tmp')
    expect(result.current.general.localShellLogin).toBe(false)
    await act(async () => {
      await result.current.saveGeneral({
        ...savedGeneral,
        localShell: '/bin/bash',
        localShellArgs: '-l',
        localShellCwd: '~',
        localShellLogin: true,
      })
    })
    expect(savedEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'terminal.local_shell', value: '"/bin/bash"' }),
      expect.objectContaining({ key: 'terminal.local_shell_args', value: '"-l"' }),
      expect.objectContaining({ key: 'terminal.local_shell_cwd', value: '"~"' }),
      expect.objectContaining({ key: 'terminal.local_shell_login', value: 'true' }),
    ]))
  })

  it('serializes concurrent saves so the newest settings persist last', async () => {
    const firstWrite = deferred<void>()
    const writes: Array<{ poolSize: number; fontSize: number }> = []
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetMany', async (entries: Array<{ key: string; value: string }>) => {
      writes.push({
        poolSize: Number(entries.find((entry) => entry.key === 'terminal.max_pool_size')?.value),
        fontSize: Number(entries.find((entry) => entry.key === 'appearance.ui_font_size')?.value),
      })
      if (writes.length === 1) await firstWrite.promise
    })
    const { result } = renderHook(() => useGeneralSettings())
    await waitFor(() => expect(result.current.settingsReady).toBe(true))

    let olderSave!: Promise<void>
    let newerSave!: Promise<void>
    act(() => {
      olderSave = result.current.saveGeneral({ ...result.current.general, uiFontSize: 18 }, { scope: 'general' })
      newerSave = result.current.saveGeneral({ ...result.current.general, maxPoolSize: 22 }, { scope: 'terminal' })
    })

    await waitFor(() => expect(writes).toEqual([{ poolSize: 10, fontSize: 18 }]))
    await act(async () => {
      firstWrite.resolve(undefined)
      await Promise.all([olderSave, newerSave])
    })

    expect(writes).toEqual([
      { poolSize: 10, fontSize: 18 },
      { poolSize: 22, fontSize: 18 },
    ])
    expect(result.current.general.maxPoolSize).toBe(22)
    expect(result.current.general.uiFontSize).toBe(18)
  })

  it('continues the save queue after an earlier write fails', async () => {
    const writes: number[] = []
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetMany', async (entries: Array<{ key: string; value: string }>) => {
      const poolSize = Number(entries.find((entry) => entry.key === 'terminal.max_pool_size')?.value)
      writes.push(poolSize)
      if (poolSize === 21) throw new Error('first write failed')
    })
    const { result } = renderHook(() => useGeneralSettings())
    await waitFor(() => expect(result.current.settingsReady).toBe(true))

    const olderSave = result.current.saveGeneral({ ...result.current.general, maxPoolSize: 21 })
    const newerSave = result.current.saveGeneral({ ...result.current.general, maxPoolSize: 22 })

    await expect(olderSave).rejects.toThrow('first write failed')
    await act(async () => { await newerSave })

    expect(writes).toEqual([21, 22])
    expect(result.current.general.maxPoolSize).toBe(22)
  })
})

describe('resolveProxyPasswordWrite', () => {
  it('keeps empty writes, clears with null, and passes exact new secrets', () => {
    expect(resolveProxyPasswordWrite({ proxyPassword: '', clearProxyPassword: false })).toBe('')
    expect(resolveProxyPasswordWrite({ proxyPassword: 'x', clearProxyPassword: true })).toBeNull()
    expect(resolveProxyPasswordWrite({ proxyPassword: 'new-secret', clearProxyPassword: false })).toBe('new-secret')
    expect(resolveProxyPasswordWrite({ proxyPassword: '__clear_proxy_password__', clearProxyPassword: false })).toBe('__clear_proxy_password__')
  })
})

describe('proxy password persistence state', () => {
  it('treats whitespace-only passwords as exact saved credentials', async () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async () => ({}))
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetMany', async () => {})
    __registerHandler('github.com/xuthus5/mssh/internal/service.TerminalService.SetMaxSize', async () => {})
    const { result } = renderHook(() => useGeneralSettings())
    await waitFor(() => expect(result.current.settingsReady).toBe(true))
    await act(async () => {
      await result.current.saveGeneral({ ...result.current.general, proxyPassword: '   ' })
    })
    expect(result.current.general.proxyPasswordSaved).toBe(true)
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

describe('quiet autosave error feedback', () => {
  it('does not toast errors when quiet is true', async () => {
    const { useToastStore } = await import('@/components/ui/toast')
    useToastStore.setState({ toasts: [] })
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async () => ({
      'terminal.max_pool_size': setting('terminal.max_pool_size', 10),
    }))
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetMany', async () => {
      throw new Error('persist failed')
    })
    const { result } = renderHook(() => useGeneralSettings())
    await waitFor(() => expect(result.current.general.maxPoolSize).toBe(10))
    await expect(result.current.saveGeneral({ ...result.current.general }, { quiet: true })).rejects.toThrow('persist failed')
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })
  it('keeps settingsReady false when load fails and exposes loadError without toast', async () => {
    const toast = await import('@/components/ui/toast')
    const toastSpy = vi.spyOn(toast, 'toast')
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async () => {
      throw new Error('settings unavailable')
    })
    const { result } = renderHook(() => useGeneralSettings())
    await act(async () => {})
    expect(result.current.settingsReady).toBe(false)
    expect(result.current.loadError).toBe('settings unavailable')
    expect(toastSpy).not.toHaveBeenCalled()
  })

  it('clears loadError after a successful reload', async () => {
    let fail = true
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async () => {
      if (fail) throw new Error('settings unavailable')
      return { 'terminal.max_pool_size': setting('terminal.max_pool_size', 12) }
    })
    const { result } = renderHook(() => useGeneralSettings())
    await act(async () => {})
    expect(result.current.loadError).toBe('settings unavailable')
    fail = false
    await act(async () => { await result.current.reloadGeneral() })
    expect(result.current.settingsReady).toBe(true)
    expect(result.current.loadError).toBe('')
    expect(result.current.general.maxPoolSize).toBe(12)
  })

  it('non-quiet save errors never toast and still throw', async () => {
    const { useToastStore } = await import('@/components/ui/toast')
    useToastStore.setState({ toasts: [] })
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async () => ({
      'terminal.max_pool_size': setting('terminal.max_pool_size', 10),
    }))
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetMany', async () => {
      throw new Error('persist failed')
    })
    const { result } = renderHook(() => useGeneralSettings())
    await waitFor(() => expect(result.current.general.maxPoolSize).toBe(10))
    await expect(result.current.saveGeneral({ ...result.current.general })).rejects.toThrow('persist failed')
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })

})
