import { useEffect } from 'react'
import { create } from 'zustand'
import { Events } from '@wailsio/runtime'
import { SettingService, ThemeService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import { resolveEffectiveTerminalProfile, type ColorMode } from '@/lib/effectiveTerminalTheme'
import { profileToTerminalTheme } from '@/lib/terminalThemeCatalog'
import { useAppStore } from '@/store/appStore'
import type { TerminalGlobalStyle, ThemeAssignments, ThemeConfigurationInput, ThemeDefinition, ThemeImportSummary, ThemeProfile, ThemeProfileInput } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { COLOR_MODE_CHANGED_EVENT, THEME_CATALOG_CHANGED_EVENT } from '@/lib/settingsWindowEvents'
import { t } from '@/i18n'


export type { ColorMode } from '@/lib/effectiveTerminalTheme'

interface ThemeCatalogState {
  definitions: ThemeDefinition[]
  profiles: ThemeProfile[]
  assignments: ThemeAssignments
  globalStyle: TerminalGlobalStyle
  colorMode: ColorMode
  loaded: boolean
  loading: boolean
  error: string | null
}

const initialState: ThemeCatalogState = {
  definitions: [],
  profiles: [],
  assignments: { dark_profile_id: 0, light_profile_id: 0, follow_interface_mode: true, fixed_profile_id: 0 } as ThemeAssignments,
  globalStyle: { font_family: '"JetBrains Mono", "Cascadia Code", monospace', font_size: 14, cursor_style: 'bar', selection_background: '#264f78' } as TerminalGlobalStyle,
  colorMode: localStorage.getItem('mssh:color-mode') === 'light' ? 'light' : 'dark',
  loaded: false,
  loading: false,
  error: null,
}

interface ThemeCatalogSnapshot {
  definitions: ThemeDefinition[]
  profiles: ThemeProfile[]
  assignments: ThemeAssignments
  globalStyle: TerminalGlobalStyle
}

interface EventEnvelope<T> { data?: T }

export const useThemeCatalogStore = create<ThemeCatalogState>(() => initialState)

export function useThemeCatalog() {
  const state = useThemeCatalogStore()
  useEffect(() => { void loadThemeCatalog() }, [])
  useEffect(() => {
    const stopCatalog = Events.On(THEME_CATALOG_CHANGED_EVENT, (event: EventEnvelope<ThemeCatalogSnapshot>) => {
      if (event.data) applyCatalogSnapshot(event.data)
    })
    const stopMode = Events.On(COLOR_MODE_CHANGED_EVENT, (event: EventEnvelope<ColorMode>) => {
      if (event.data) applySynchronizedColorMode(event.data)
    })
    return () => { stopCatalog(); stopMode() }
  }, [])
  return { ...state, reload: loadThemeCatalog, setColorMode: changeColorMode, saveAssignments, saveConfiguration, saveProfile, createProfile, importThemes, deleteProfile, deleteDefinition, resetBuiltinStyles }
}

export async function loadThemeCatalog(): Promise<boolean> {
  const current = useThemeCatalogStore.getState()
  if (current.loading || current.loaded) return current.loaded
  useThemeCatalogStore.setState({ loading: true, error: null })
  try {
    await ThemeService.InitializeDefaults()
    const [definitions, profiles, assignments, globalStyle, colorSetting] = await Promise.all([ThemeService.ListDefinitions(''), ThemeService.ListProfiles(''), ThemeService.GetAssignments(), ThemeService.GetGlobalStyle(), SettingService.Get('appearance.color_mode')])
    const colorMode = parseColorMode(colorSetting?.value)
    useThemeCatalogStore.setState({ definitions, profiles, assignments, globalStyle, colorMode, loaded: true, loading: false })
    applyInterfaceColorMode(colorMode)
    applyEffectiveTerminalTheme()
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    useThemeCatalogStore.setState({ loading: false, error: message })
    logger.error('load theme catalog failed', error)
    return false
  }
}

export async function changeColorMode(nextMode: ColorMode) {
  const state = useThemeCatalogStore.getState()
  const previousMode = state.colorMode
  const followsInterfaceMode = state.assignments.follow_interface_mode
  applyInterfaceColorMode(nextMode)
  try {
    if (followsInterfaceMode) applyEffectiveTerminalTheme()
    await SettingService.Set({ key: 'appearance.color_mode', namespace: 'appearance', value: JSON.stringify(nextMode), value_type: 'string', version: 1 })
    emitThemeEvent(COLOR_MODE_CHANGED_EVENT, nextMode)
  } catch (error) {
    applyInterfaceColorMode(previousMode)
    if (followsInterfaceMode) applyEffectiveTerminalTheme()
    toast(t('主题设置保存失败，已恢复原主题'), 'error')
    logger.error('save colour mode failed', error)
  }
}

export async function saveAssignments(assignments: ThemeAssignments) {
  await ThemeService.SaveAssignments(assignments)
  useThemeCatalogStore.setState({ assignments })
  applyEffectiveTerminalTheme()
  broadcastThemeCatalog()
}

export async function saveProfile(profile: ThemeProfileInput) {
  await ThemeService.UpdateProfile(profile)
  await refreshThemeCatalog()
}

export async function createProfile(profile: ThemeProfileInput) {
  const created = await ThemeService.CreateCustomProfile(profile)
  await refreshThemeCatalog()
  return created
}

export async function saveConfiguration(configuration: ThemeConfigurationInput) {
  await ThemeService.SaveConfiguration(configuration)
  await refreshThemeCatalog()
}

export async function importThemes(paths: string[]): Promise<ThemeImportSummary> {
  const summary = await ThemeService.ImportFiles(paths)
  await refreshThemeCatalog()
  return summary
}

export async function deleteProfile(id: number) {
  await ThemeService.DeleteProfile(id)
  await refreshThemeCatalog()
}

export async function deleteDefinition(id: number) {
  await ThemeService.DeleteDefinition(id)
  await refreshThemeCatalog()
}

export async function resetBuiltinStyles() {
  const result = await ThemeService.ResetBuiltinStyles()
  await refreshThemeCatalog()
  return result
}

function applyInterfaceColorMode(mode: ColorMode) {
  document.documentElement.classList.toggle('light', mode === 'light')
  localStorage.setItem('mssh:color-mode', mode)
  useThemeCatalogStore.setState({ colorMode: mode })
}

function applySynchronizedColorMode(mode: ColorMode) {
  applyInterfaceColorMode(mode)
  if (useThemeCatalogStore.getState().assignments.follow_interface_mode) applyEffectiveTerminalTheme()
}

function applyEffectiveTerminalTheme() {
  const state = useThemeCatalogStore.getState()
  const profile = resolveEffectiveTerminalProfile(state.assignments, state.colorMode, state.profiles)
  useAppStore.getState().setTerminalTheme(profileToTerminalTheme(profile, state.globalStyle))
}

function applyCatalogSnapshot(snapshot: ThemeCatalogSnapshot) {
  useThemeCatalogStore.setState({ ...snapshot, loaded: true, loading: false, error: null })
  applyEffectiveTerminalTheme()
}

function emitThemeEvent(name: string, data: unknown) {
  void Events.Emit(name, data).catch((error: unknown) => logger.error(`emit ${name} failed`, error))
}

function broadcastThemeCatalog() {
  const state = useThemeCatalogStore.getState()
  emitThemeEvent(THEME_CATALOG_CHANGED_EVENT, {
    definitions: state.definitions,
    profiles: state.profiles,
    assignments: state.assignments,
    globalStyle: state.globalStyle,
  } satisfies ThemeCatalogSnapshot)
}

async function refreshThemeCatalog() {
  await loadThemeCatalogFresh()
  broadcastThemeCatalog()
}

async function loadThemeCatalogFresh() {
  useThemeCatalogStore.setState({ loaded: false, loading: false })
  const loaded = await loadThemeCatalog()
  if (!loaded) throw new Error(useThemeCatalogStore.getState().error ?? 'load theme catalog failed')
}

function parseColorMode(value?: string): ColorMode {
  if (!value) return localStorage.getItem('mssh:color-mode') === 'light' ? 'light' : 'dark'
  try { return JSON.parse(value) === 'light' ? 'light' : 'dark' } catch { return 'dark' }
}
