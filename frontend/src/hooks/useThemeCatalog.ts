import { useEffect } from 'react'
import { create } from 'zustand'
import { SettingService, ThemeService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import { profileToTerminalTheme } from '@/lib/terminalThemeCatalog'
import { useAppStore } from '@/store/appStore'
import type { ThemeAssignments, ThemeConfigurationInput, ThemeDefinition, ThemeImportSummary, ThemeProfile, ThemeProfileInput } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'

export type ColorMode = 'dark' | 'light'

interface ThemeCatalogState {
  definitions: ThemeDefinition[]
  profiles: ThemeProfile[]
  assignments: ThemeAssignments
  colorMode: ColorMode
  loaded: boolean
  loading: boolean
  error: string | null
}

const initialState: ThemeCatalogState = { definitions: [], profiles: [], assignments: { dark_profile_id: 0, light_profile_id: 0 } as ThemeAssignments, colorMode: localStorage.getItem('mssh:color-mode') === 'light' ? 'light' : 'dark', loaded: false, loading: false, error: null }

export const useThemeCatalogStore = create<ThemeCatalogState>(() => initialState)

export function useThemeCatalog() {
  const state = useThemeCatalogStore()
  useEffect(() => { void loadThemeCatalog() }, [])
  return { ...state, reload: loadThemeCatalog, setColorMode: changeColorMode, saveAssignments, saveConfiguration, saveProfile, createProfile, importThemes, deleteProfile, deleteDefinition }
}

export async function loadThemeCatalog() {
  const current = useThemeCatalogStore.getState()
  if (current.loading || current.loaded) return
  useThemeCatalogStore.setState({ loading: true, error: null })
  try {
    await ThemeService.InitializeDefaults()
    const [definitions, profiles, assignments, colorSetting] = await Promise.all([ThemeService.ListDefinitions(''), ThemeService.ListProfiles(''), ThemeService.GetAssignments(), SettingService.Get('appearance.color_mode')])
    const colorMode = parseColorMode(colorSetting?.value)
    useThemeCatalogStore.setState({ definitions, profiles, assignments, colorMode, loaded: true, loading: false })
    applyColorMode(colorMode)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    useThemeCatalogStore.setState({ loading: false, error: message })
    logger.error('load theme catalog failed', error)
  }
}

export async function changeColorMode(nextMode: ColorMode) {
  const previousMode = useThemeCatalogStore.getState().colorMode
  applyColorMode(nextMode)
  try {
    await SettingService.Set({ key: 'appearance.color_mode', namespace: 'appearance', value: JSON.stringify(nextMode), value_type: 'string', version: 1 })
  } catch (error) {
    applyColorMode(previousMode)
    toast('主题设置保存失败，已恢复原主题', 'error')
    logger.error('save colour mode failed', error)
  }
}

export async function saveAssignments(assignments: ThemeAssignments) {
  await ThemeService.SaveAssignments(assignments)
  useThemeCatalogStore.setState({ assignments })
  applyColorMode(useThemeCatalogStore.getState().colorMode)
}

export async function saveProfile(profile: ThemeProfileInput) {
  await ThemeService.UpdateProfile(profile)
  await loadThemeCatalogFresh()
}

export async function createProfile(profile: ThemeProfileInput) {
  const created = await ThemeService.CreateCustomProfile(profile)
  await loadThemeCatalogFresh()
  return created
}

export async function saveConfiguration(configuration: ThemeConfigurationInput) {
  await ThemeService.SaveConfiguration(configuration)
  await loadThemeCatalogFresh()
}

export async function importThemes(paths: string[]): Promise<ThemeImportSummary> {
  const summary = await ThemeService.ImportFiles(paths)
  await loadThemeCatalogFresh()
  return summary
}

export async function deleteProfile(id: number) {
  await ThemeService.DeleteProfile(id)
  await loadThemeCatalogFresh()
}

export async function deleteDefinition(id: number) {
  await ThemeService.DeleteDefinition(id)
  await loadThemeCatalogFresh()
}

function applyColorMode(mode: ColorMode) {
  document.documentElement.classList.toggle('light', mode === 'light')
  localStorage.setItem('mssh:color-mode', mode)
  useThemeCatalogStore.setState({ colorMode: mode })
  const state = useThemeCatalogStore.getState()
  const profileID = mode === 'dark' ? state.assignments.dark_profile_id : state.assignments.light_profile_id
  const profile = state.profiles.find((item) => item.id === profileID) ?? state.profiles.find((item) => item.definition?.mode === mode || item.definition?.mode === 'universal')
  if (profile) useAppStore.getState().setTerminalTheme(profileToTerminalTheme(profile))
}

async function loadThemeCatalogFresh() {
  useThemeCatalogStore.setState({ loaded: false, loading: false })
  await loadThemeCatalog()
}

function parseColorMode(value?: string): ColorMode {
  if (!value) return localStorage.getItem('mssh:color-mode') === 'light' ? 'light' : 'dark'
  try { return JSON.parse(value) === 'light' ? 'light' : 'dark' } catch { return 'dark' }
}
