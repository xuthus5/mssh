import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { __clearHandlers, __emitEvent, __registerHandler } from '@/test/__mocks__/wails-runtime'
import { useShortcutSettings } from '@/hooks/useShortcutSettings'
import {
  SHORTCUT_SETTING_KEY,
  SHORTCUTS_CHANGED_EVENT,
  defaultShortcutBindings,
  serializeShortcutBindings,
} from '@/lib/shortcuts'
import { useShortcutStore } from '@/store/shortcutStore'
import { useToastStore } from '@/components/ui/toast'

describe('useShortcutSettings', () => {
  beforeEach(() => {
    __clearHandlers()
    useShortcutStore.setState({ bindings: defaultShortcutBindings(), settingsHydrated: false })
    useToastStore.setState({ toasts: [] })
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.Get', async () => ({
      key: SHORTCUT_SETTING_KEY,
      namespace: 'application',
      value: JSON.stringify({ 'new-session': 'Mod+Shift+S' }),
      value_type: 'object',
      version: 1,
      updated_at: '',
    }))
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.Set', async () => {})
  })

  it('loads persisted bindings into store', async () => {
    const { result } = renderHook(() => useShortcutSettings())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.bindings['new-session']).toEqual({
      ctrl: true, meta: false, alt: false, shift: true, key: 's',
    })
    expect(useShortcutStore.getState().bindings['new-session']?.key).toBe('s')
  })

  it('applies remote shortcut change events', async () => {
    renderHook(() => useShortcutSettings())
    await waitFor(() => expect(useShortcutStore.getState().settingsHydrated).toBe(true))
    act(() => {
      __emitEvent(SHORTCUTS_CHANGED_EVENT, {
        data: serializeShortcutBindings({
          ...defaultShortcutBindings(),
          'close-tab': null,
        }),
      })
    })
    await waitFor(() => expect(useShortcutStore.getState().bindings['close-tab']).toBeNull())
  })
})

  it('falls back to defaults when load fails and toasts error', async () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.Get', async () => {
      throw new Error('shortcut load failed')
    })
    const { result } = renderHook(() => useShortcutSettings())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.bindings['new-session']).toEqual(defaultShortcutBindings()['new-session'])
    expect(useToastStore.getState().toasts.some((item) => item.message.includes('shortcut load failed'))).toBe(true)
  })
