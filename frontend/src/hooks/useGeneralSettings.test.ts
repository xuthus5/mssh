import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Events } from '@wailsio/runtime'
import { useGeneralSettings } from '@/hooks/useGeneralSettings'
import { useAppStore } from '@/store/appStore'
import { __clearHandlers, __emitEvent, __registerHandler } from '@/test/__mocks__/wails-runtime'
import { SETTINGS_GENERAL_CHANGED_EVENT, SETTINGS_GENERAL_PREVIEW_EVENT, SETTINGS_PREVIEW_CANCELLED_EVENT } from '@/lib/settingsWindowEvents'

const savedGeneral = {
  maxPoolSize: 24, defaultKeepAlive: 90, defaultTermType: 'xterm',
  uiFontFamily: 'Arial', uiFontFallbackFamily: 'Segoe UI', uiFontSize: 18,
  rightClickAction: 'paste' as const, copyOnSelect: true,
  closeButtonAction: 'exit' as const,
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
})

function setting(key: string, value: unknown) {
  return { key, namespace: key.split('.')[0], value: JSON.stringify(value), value_type: typeof value, version: 1, updated_at: '' }
}
