import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '@/components/ui/toast'
import { __clearHandlers, __emitEvent, __registerHandler } from '@/test/__mocks__/wails-runtime'
import { changeColorMode, useThemeCatalog, useThemeCatalogStore } from '@/hooks/useThemeCatalog'
import { useAppStore } from '@/store/appStore'
import { CursorStyle } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { COLOR_MODE_CHANGED_EVENT, THEME_CATALOG_CHANGED_EVENT } from '@/lib/settingsWindowEvents'

const darkProfile = profile(1, 'dark', '#000000')
const lightProfile = profile(2, 'light', '#ffffff')
const fixedProfile = profile(3, 'dark', '#123456')
const globalStyle = { font_family: 'Global Font', font_size: 15, cursor_style: CursorStyle.CursorStyleUnderline, selection_background: '#4f46e5' }

describe('useThemeCatalog', () => {
  beforeEach(() => {
    __clearHandlers()
    localStorage.clear()
    document.documentElement.classList.remove('light')
    useThemeCatalogStore.setState({ definitions: [], profiles: [], assignments: { dark_profile_id: 0, light_profile_id: 0, follow_interface_mode: true, fixed_profile_id: 0 }, globalStyle, colorMode: 'dark', loaded: false, loading: false, error: null })
    registerCatalogHandlers('light')
  })

  it('loads the persisted mode and applies its assigned terminal profile', async () => {
    renderHook(() => useThemeCatalog())
    await waitFor(() => expect(useThemeCatalogStore.getState().loaded).toBe(true))
    expect(useThemeCatalogStore.getState().colorMode).toBe('light')
    expect(document.documentElement).toHaveClass('light')
    expect(useAppStore.getState().terminalTheme.background).toBe('#ffffff')
    expect(useAppStore.getState().terminalTheme).toMatchObject({ fontFamily: 'Global Font', fontSize: 15, cursorStyle: 'underline', cursor: '#888888' })
  })

  it('uses the Profile typography when global following is disabled', async () => {
    const independentDark = { ...darkProfile, follow_global_style: false, font_family: 'Profile Font', font_size: 19, cursor_style: 'block' }
    registerCatalogHandlers('dark', undefined, [independentDark, lightProfile, fixedProfile])
    renderHook(() => useThemeCatalog())
    await waitFor(() => expect(useThemeCatalogStore.getState().loaded).toBe(true))

    expect(useAppStore.getState().terminalTheme).toMatchObject({ fontFamily: 'Profile Font', fontSize: 19, cursorStyle: 'block', cursor: '#888888' })
  })

  it('rolls back interface and terminal themes when persistence fails', async () => {
    registerCatalogHandlers('dark')
    renderHook(() => useThemeCatalog())
    await waitFor(() => expect(useThemeCatalogStore.getState().loaded).toBe(true))
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.Set', async () => { throw new Error('db failed') })

    await act(async () => { await changeColorMode('light') })

    expect(useThemeCatalogStore.getState().colorMode).toBe('dark')
    expect(document.documentElement).not.toHaveClass('light')
    expect(useAppStore.getState().terminalTheme.background).toBe('#000000')
  })

  it('does not update terminal theme when interface mode changes with follow disabled', async () => {
    registerCatalogHandlers('dark', { dark_profile_id: 1, light_profile_id: 2, follow_interface_mode: false, fixed_profile_id: 3 })
    renderHook(() => useThemeCatalog())
    await waitFor(() => expect(useThemeCatalogStore.getState().loaded).toBe(true))
    const before = useAppStore.getState().terminalTheme

    await act(async () => { await changeColorMode('light') })

    expect(useAppStore.getState().terminalTheme).toBe(before)
    expect(useAppStore.getState().terminalTheme.background).toBe('#123456')
    expect(document.documentElement).toHaveClass('light')
  })

  it('updates terminal theme when interface mode changes with follow enabled', async () => {
    registerCatalogHandlers('dark')
    renderHook(() => useThemeCatalog())
    await waitFor(() => expect(useThemeCatalogStore.getState().loaded).toBe(true))
    expect(useAppStore.getState().terminalTheme.background).toBe('#000000')

    await act(async () => { await changeColorMode('light') })

    expect(useAppStore.getState().terminalTheme.background).toBe('#ffffff')
  })

  it('applies theme catalog snapshots emitted by the settings window', async () => {
    renderHook(() => useThemeCatalog())
    await waitFor(() => expect(useThemeCatalogStore.getState().loaded).toBe(true))
    const synchronizedDark = profile(4, 'dark', '#224466')
    act(() => __emitEvent(THEME_CATALOG_CHANGED_EVENT, { data: {
      definitions: [synchronizedDark.definition], profiles: [synchronizedDark],
      assignments: { dark_profile_id: 4, light_profile_id: 4, follow_interface_mode: true, fixed_profile_id: 0 },
      globalStyle,
    } }))
    expect(useThemeCatalogStore.getState().profiles[0].id).toBe(4)
    expect(useAppStore.getState().terminalTheme.background).toBe('#224466')
  })

  it('synchronizes colour mode and effective terminal theme across windows', async () => {
    renderHook(() => useThemeCatalog())
    await waitFor(() => expect(useThemeCatalogStore.getState().loaded).toBe(true))
    act(() => __emitEvent(COLOR_MODE_CHANGED_EVENT, { data: 'dark' }))
    expect(useThemeCatalogStore.getState().colorMode).toBe('dark')
    expect(document.documentElement).not.toHaveClass('light')
    expect(useAppStore.getState().terminalTheme.background).toBe('#000000')
  })

  it('executes catalog mutation actions and reloads state', async () => {
    const saveAssignments = vi.fn(async () => {})
    const saveConfiguration = vi.fn(async () => {})
    const updateProfile = vi.fn(async () => {})
    const createProfile = vi.fn(async () => darkProfile)
    const importFiles = vi.fn(async () => ({ results: [] }))
    const deleteProfile = vi.fn(async () => {})
    const deleteDefinition = vi.fn(async () => {})
    __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.SaveAssignments', saveAssignments)
    __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.SaveConfiguration', saveConfiguration)
    __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.UpdateProfile', updateProfile)
    __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.CreateCustomProfile', createProfile)
    __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.ImportFiles', importFiles)
    __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.DeleteProfile', deleteProfile)
    __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.DeleteDefinition', deleteDefinition)
    const { result } = renderHook(() => useThemeCatalog())
    await waitFor(() => expect(result.current.loaded).toBe(true))

    await act(async () => {
      await result.current.saveAssignments({ dark_profile_id: 1, light_profile_id: 2, follow_interface_mode: true, fixed_profile_id: 0 } as never)
      await result.current.saveConfiguration({ profiles: [], assignments: {} } as never)
      await result.current.saveProfile({ id: 1 } as never)
      await result.current.createProfile({ id: 0 } as never)
      await result.current.importThemes(['/tmp/a.itermcolors'])
      await result.current.deleteProfile(3)
      await result.current.deleteDefinition(4)
    })

    expect(saveAssignments).toHaveBeenCalledOnce()
    expect(saveConfiguration).toHaveBeenCalledOnce()
    expect(updateProfile).toHaveBeenCalledOnce()
    expect(createProfile).toHaveBeenCalledOnce()
    expect(importFiles).toHaveBeenCalledOnce()
    expect(deleteProfile).toHaveBeenCalledOnce()
    expect(deleteDefinition).toHaveBeenCalledOnce()
  })

  it('applies the saved profile immediately for the active mode', async () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.SaveConfiguration', async () => {})
    const { result } = renderHook(() => useThemeCatalog())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    const savedProfile = { ...darkProfile, color_overrides: JSON.stringify({ background: '#123456', selection: '#fedcba' }) }
    __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.ListProfiles', async () => [savedProfile, lightProfile, fixedProfile])
    __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.GetAssignments', async () => ({ dark_profile_id: 1, light_profile_id: 1, follow_interface_mode: true, fixed_profile_id: 0 }))
    await act(async () => {
      await result.current.saveConfiguration({
        global_style: globalStyle,
        profiles: [{ id: 1, name: 'dark', theme_id: 1, follow_global_style: true, font_family: 'monospace', font_size: 14, cursor_style: 'bar', color_overrides: JSON.stringify({ background: '#123456' }) }],
        assignments: { dark_profile_id: 1, light_profile_id: 1, follow_interface_mode: true, fixed_profile_id: 0 },
      } as never)
    })
    expect(useThemeCatalogStore.getState().assignments.light_profile_id).toBe(1)
    expect(useAppStore.getState().terminalTheme.background).toBe('#123456')
    expect(useAppStore.getState().terminalTheme.selectionBackground).toBe('#4f46e5')
  })

  it('reloads and hot-applies a saved global terminal style', async () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.SaveConfiguration', async () => {})
    const { result } = renderHook(() => useThemeCatalog())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    const savedGlobalStyle = { font_family: 'Saved Global Font', font_size: 18, cursor_style: CursorStyle.CursorStyleBar, selection_background: '#123456' }
    __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.GetGlobalStyle', async () => savedGlobalStyle)

    await act(async () => {
      await result.current.saveConfiguration({
        global_style: savedGlobalStyle,
        profiles: [],
        assignments: { dark_profile_id: 1, light_profile_id: 2, follow_interface_mode: true, fixed_profile_id: 0 },
      } as never)
    })

    expect(useThemeCatalogStore.getState().globalStyle).toEqual(savedGlobalStyle)
    expect(useAppStore.getState().terminalTheme).toMatchObject({ fontFamily: 'Saved Global Font', fontSize: 18, cursorStyle: 'bar', cursor: '#888888', selectionBackground: '#123456' })
  })

  it('keeps the catalog and active terminal theme unchanged when configuration save fails', async () => {
    const { result } = renderHook(() => useThemeCatalog())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    const catalogBefore = useThemeCatalogStore.getState()
    const terminalThemeBefore = useAppStore.getState().terminalTheme
    __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.SaveConfiguration', async () => { throw new Error('db failed') })

    await expect(result.current.saveConfiguration({
      global_style: { font_family: 'Rejected Font', font_size: 20, cursor_style: CursorStyle.CursorStyleBlock, selection_background: '#123456' },
      profiles: [],
      assignments: catalogBefore.assignments,
    } as never)).rejects.toThrow('db failed')

    expect(useThemeCatalogStore.getState()).toEqual(catalogBefore)
    expect(useAppStore.getState().terminalTheme).toBe(terminalThemeBefore)
  })

  it('keeps configuration save success when catalog reload fails', async () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.SaveConfiguration', async () => {})
    const { result } = renderHook(() => useThemeCatalog())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    useToastStore.setState({ toasts: [] })
    __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.ListProfiles', async () => { throw new Error('reload failed') })

    await act(async () => {
      await result.current.saveConfiguration({
        global_style: globalStyle,
        profiles: [],
        assignments: { dark_profile_id: 1, light_profile_id: 2, follow_interface_mode: true, fixed_profile_id: 0 },
      } as never)
    })
    const messages = useToastStore.getState().toasts.map((item) => item.message)
    expect(messages.some((message) => message.includes('reload failed'))).toBe(false)
    expect(messages.some((message) => message.includes('加载主题失败'))).toBe(false)
  })

  it('reloads and hot-applies the active theme after resetting built-in styles', async () => {
    const resetBuiltinStyles = vi.fn(async () => ({ dark_reset: true, light_reset: false, fixed_reset: false }))
    __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.ResetBuiltinStyles', resetBuiltinStyles)
    const { result } = renderHook(() => useThemeCatalog())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    const reloadedLight = profile(2, 'light', '#f5f5f5')
    __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.ListProfiles', async () => [darkProfile, reloadedLight])

    let resetResult: { dark_reset: boolean; light_reset: boolean; fixed_reset: boolean } | undefined
    await act(async () => { resetResult = await result.current.resetBuiltinStyles() })

    expect(resetBuiltinStyles).toHaveBeenCalledOnce()
    expect(resetResult).toEqual({ dark_reset: true, light_reset: false, fixed_reset: false })
    expect(useThemeCatalogStore.getState().profiles[1].definition?.color_payload).toContain('#f5f5f5')
    expect(useAppStore.getState().terminalTheme.background).toBe('#f5f5f5')
  })

  it('keeps mutation success when post-mutation silent catalog refresh fails', async () => {
    useToastStore.setState({ toasts: [] })
    registerCatalogHandlers('dark')
    __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.DeleteProfile', async () => undefined)
    const { result } = renderHook(() => useThemeCatalog())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.ListProfiles', async () => { throw new Error('reload boom') })
    await act(async () => { await result.current.deleteProfile(3) })
    const messages = useToastStore.getState().toasts.map((item) => item.message)
    expect(messages.some((message) => message.includes('加载主题失败'))).toBe(false)
    expect(messages.some((message) => message.includes('reload boom'))).toBe(false)
  })
})

function registerCatalogHandlers(
  mode: 'dark' | 'light',
  assignments = { dark_profile_id: 1, light_profile_id: 2, follow_interface_mode: true, fixed_profile_id: 0 },
  profiles = [darkProfile, lightProfile, fixedProfile],
) {
  __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.InitializeDefaults', async () => {})
  __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.ListDefinitions', async () => [darkProfile.definition, lightProfile.definition, fixedProfile.definition])
  __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.ListProfiles', async () => profiles)
  __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.GetAssignments', async () => assignments)
  __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.GetGlobalStyle', async () => globalStyle)
  __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.Get', async () => ({ key: 'appearance.color_mode', namespace: 'appearance', value: JSON.stringify(mode), value_type: 'string', version: 1, updated_at: '' }))
  __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.Set', async () => {})
}

function profile(id: number, mode: 'dark' | 'light', background: string) {
  return { id, name: mode, theme_id: id, follow_global_style: true, font_family: 'monospace', font_size: 14, cursor_style: 'bar', color_overrides: '{}', created_at: '', updated_at: '', definition: { id, name: mode, mode, source_type: 'builtin', source_name: '', source_url: '', source_author: '', source_license: '', source_version: '', source_fingerprint: mode, color_payload: JSON.stringify({ background, foreground: mode === 'dark' ? '#ffffff' : '#000000', cursor: '#888888', selection: '#264f78', ansi: Array(16).fill('#111111') }), raw_payload: '', is_builtin: true, created_at: '', updated_at: '' } }
}

