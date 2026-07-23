import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Events } from '@wailsio/runtime'
import { useSFTPSettings } from '@/hooks/useSFTPSettings'
import { DEFAULT_SFTP_SETTINGS } from '@/lib/sftpSettings'
import { SETTINGS_SFTP_CHANGED_EVENT } from '@/lib/settingsWindowEvents'
import { useSFTPSettingsStore } from '@/store/sftpSettingsStore'
import { __clearHandlers, __emitEvent, __registerHandler } from '@/test/__mocks__/wails-runtime'
import { logger } from '@/lib/logger'

function setting(key: string, value: unknown) {
  return { key, namespace: key.split('.')[0], value: JSON.stringify(value), value_type: typeof value, version: 1, updated_at: '' }
}

describe('useSFTPSettings', () => {
  beforeEach(() => {
    __clearHandlers()
    useSFTPSettingsStore.setState(DEFAULT_SFTP_SETTINGS)
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async () => ({}))
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetMany', async () => {})
  })

  it('loads defaults when no SFTP settings exist', async () => {
    const { result } = renderHook(() => useSFTPSettings())
    await waitFor(() => expect(result.current.settings).toEqual(DEFAULT_SFTP_SETTINGS))
  })

  it('loads persisted values and normalizes an unsupported view', async () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async () => ({
      'sftp.show_hidden_files': setting('sftp.show_hidden_files', true),
      'sftp.follow_terminal_directory': setting('sftp.follow_terminal_directory', true),
      'sftp.default_view': setting('sftp.default_view', 'grid'),
    }))
    const { result } = renderHook(() => useSFTPSettings())

    await waitFor(() => expect(result.current.settings).toEqual({ showHiddenFiles: true, followTerminalDirectory: true, defaultView: 'list' }))
    expect(useSFTPSettingsStore.getState()).toEqual(expect.objectContaining({ showHiddenFiles: true, followTerminalDirectory: true, defaultView: 'list' }))
  })

  it('persists all settings and broadcasts the normalized value', async () => {
    let entries: Array<{ key: string; value: string }> = []
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetMany', async (values) => { entries = values })
    const received: unknown[] = []
    const stop = Events.On(SETTINGS_SFTP_CHANGED_EVENT, (event) => received.push(event.data))
    const { result } = renderHook(() => useSFTPSettings())

    await act(async () => { await result.current.save({ showHiddenFiles: true, followTerminalDirectory: false, defaultView: 'tree' }) })

    expect(entries).toEqual([
      expect.objectContaining({ key: 'sftp.show_hidden_files', value: 'true' }),
      expect.objectContaining({ key: 'sftp.follow_terminal_directory', value: 'false' }),
      expect.objectContaining({ key: 'sftp.default_view', value: '"tree"' }),
    ])
    expect(received).toContainEqual({ showHiddenFiles: true, followTerminalDirectory: false, defaultView: 'tree' })
    stop()
  })

  it('applies settings changed in another window', async () => {
    const { result } = renderHook(() => useSFTPSettings())
    await act(async () => {})
    act(() => __emitEvent(SETTINGS_SFTP_CHANGED_EVENT, { data: { showHiddenFiles: true, followTerminalDirectory: true, defaultView: 'tree' } }))

    expect(result.current.settings).toEqual({ showHiddenFiles: true, followTerminalDirectory: true, defaultView: 'tree' })
    expect(useSFTPSettingsStore.getState().defaultView).toBe('tree')
  })

  it('does not publish or update state when saving fails', async () => {
    const loggerError = vi.spyOn(logger, 'debug').mockImplementation(() => {})
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetMany', async () => { throw new Error('save failed') })
    const received: unknown[] = []
    const stop = Events.On(SETTINGS_SFTP_CHANGED_EVENT, (event) => received.push(event.data))
    const { result } = renderHook(() => useSFTPSettings())
    await act(async () => { await expect(result.current.save({ showHiddenFiles: true, followTerminalDirectory: false, defaultView: 'list' })).rejects.toThrow('save failed') })

    expect(result.current.settings).toEqual(DEFAULT_SFTP_SETTINGS)
    expect(received).toHaveLength(0)
    expect(loggerError).toHaveBeenCalled()
    stop()
    loggerError.mockRestore()
  })
})

describe('quiet SFTP autosave error feedback', () => {
  beforeEach(() => {
    __clearHandlers()
    useSFTPSettingsStore.setState(DEFAULT_SFTP_SETTINGS)
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async () => ({}))
  })

  it('does not toast errors when quiet is true', async () => {
    const { useToastStore } = await import('@/components/ui/toast')
    useToastStore.setState({ toasts: [] })
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.SetMany', async () => {
      throw new Error('sftp save failed')
    })
    const { result } = renderHook(() => useSFTPSettings())
    await waitFor(() => expect(result.current.settings).toBeTruthy())
    await expect(result.current.save(result.current.settings, { quiet: true })).rejects.toThrow('sftp save failed')
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })
  it('keeps settingsReady false when SFTP settings load fails without toast', async () => {
    const toast = await import('@/components/ui/toast')
    const toastSpy = vi.spyOn(toast, 'toast')
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async () => {
      throw new Error('sftp load failed')
    })
    const { result } = renderHook(() => useSFTPSettings())
    await act(async () => {})
    expect(result.current.settingsReady).toBe(false)
    expect(result.current.loadError).toBe('sftp load failed')
    expect(toastSpy).not.toHaveBeenCalled()
  })

  it('clears SFTP loadError after a successful reload', async () => {
    let fail = true
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.GetMany', async () => {
      if (fail) throw new Error('sftp load failed')
      return {
        'sftp.show_hidden_files': setting('sftp.show_hidden_files', true),
        'sftp.follow_terminal_directory': setting('sftp.follow_terminal_directory', false),
        'sftp.default_view': setting('sftp.default_view', 'tree'),
      }
    })
    const { result } = renderHook(() => useSFTPSettings())
    await act(async () => {})
    expect(result.current.loadError).toBe('sftp load failed')
    fail = false
    await act(async () => { await result.current.reload() })
    expect(result.current.settingsReady).toBe(true)
    expect(result.current.loadError).toBe('')
    expect(result.current.settings).toEqual({ showHiddenFiles: true, followTerminalDirectory: false, defaultView: 'tree' })
  })

})

