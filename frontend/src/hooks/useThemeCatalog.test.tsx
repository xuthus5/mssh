import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'
import { changeColorMode, useThemeCatalog, useThemeCatalogStore } from '@/hooks/useThemeCatalog'
import { useAppStore } from '@/store/appStore'

const darkProfile = profile(1, 'dark', '#000000')
const lightProfile = profile(2, 'light', '#ffffff')

describe('useThemeCatalog', () => {
  beforeEach(() => {
    __clearHandlers()
    localStorage.clear()
    document.documentElement.classList.remove('light')
    useThemeCatalogStore.setState({ definitions: [], profiles: [], assignments: { dark_profile_id: 0, light_profile_id: 0 }, colorMode: 'dark', loaded: false, loading: false, error: null })
    registerCatalogHandlers('light')
  })

  it('loads the persisted mode and applies its assigned terminal profile', async () => {
    renderHook(() => useThemeCatalog())
    await waitFor(() => expect(useThemeCatalogStore.getState().loaded).toBe(true))
    expect(useThemeCatalogStore.getState().colorMode).toBe('light')
    expect(document.documentElement).toHaveClass('light')
    expect(useAppStore.getState().terminalTheme.background).toBe('#ffffff')
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
      await result.current.saveAssignments({ dark_profile_id: 1, light_profile_id: 2 } as never)
      await result.current.saveConfiguration({ dark_profile: {}, light_profile: {}, assignments: {} } as never)
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
    await act(async () => {
      await result.current.saveConfiguration({
        dark_profile: { id: 1, name: 'dark', theme_id: 1, font_family: 'monospace', font_size: 14, cursor_style: 'bar', color_overrides: JSON.stringify({ background: '#123456' }) },
        light_profile: { id: 1, name: 'dark', theme_id: 1, font_family: 'monospace', font_size: 14, cursor_style: 'bar', color_overrides: JSON.stringify({ background: '#123456' }) },
        assignments: { dark_profile_id: 1, light_profile_id: 1 },
      } as never)
    })
    expect(useThemeCatalogStore.getState().assignments.light_profile_id).toBe(1)
    expect(useAppStore.getState().terminalTheme.background).toBe('#123456')
  })
})

function registerCatalogHandlers(mode: 'dark' | 'light') {
  __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.InitializeDefaults', async () => {})
  __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.ListDefinitions', async () => [darkProfile.definition, lightProfile.definition])
  __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.ListProfiles', async () => [darkProfile, lightProfile])
  __registerHandler('github.com/xuthus5/mssh/internal/service.ThemeService.GetAssignments', async () => ({ dark_profile_id: 1, light_profile_id: 2 }))
  __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.Get', async () => ({ key: 'appearance.color_mode', namespace: 'appearance', value: JSON.stringify(mode), value_type: 'string', version: 1, updated_at: '' }))
  __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.Set', async () => {})
}

function profile(id: number, mode: 'dark' | 'light', background: string) {
  return { id, name: mode, theme_id: id, font_family: 'monospace', font_size: 14, cursor_style: 'bar', color_overrides: '{}', created_at: '', updated_at: '', definition: { id, name: mode, mode, source_type: 'builtin', source_name: '', source_url: '', source_author: '', source_license: '', source_version: '', source_fingerprint: mode, color_payload: JSON.stringify({ background, foreground: mode === 'dark' ? '#ffffff' : '#000000', cursor: '#888888', selection: '#264f78', ansi: Array(16).fill('#111111') }), raw_payload: '', is_builtin: true, created_at: '', updated_at: '' } }
}
