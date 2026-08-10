import { useEffect } from 'react'
import { create } from 'zustand'
import { Events } from '@wailsio/runtime'
import { SettingService, ThemeService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { resolveEffectiveTerminalProfile, type ColorMode } from '@/lib/effectiveTerminalTheme'
import { profileToTerminalTheme } from '@/lib/terminalThemeCatalog'
import { useAppStore } from '@/store/appStore'
import type { TerminalGlobalStyle, ThemeAssignments, ThemeConfigurationInput, ThemeDefinition, ThemeImportSummary, ThemeProfile, ThemeProfileInput } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { COLOR_MODE_CHANGED_EVENT, THEME_CATALOG_CHANGED_EVENT } from '@/lib/settingsWindowEvents'
import { t } from '@/i18n'
import { readStorageItem, writeStorageItem } from '@/lib/safeStorage'
import { syncDataChangedEvent } from '@/lib/syncDataReload'


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
  colorModeError: string | null
}

const initialState: ThemeCatalogState = {
  definitions: [],
  profiles: [],
  assignments: { dark_profile_id: 0, light_profile_id: 0, follow_interface_mode: true, fixed_profile_id: 0 } as ThemeAssignments,
  globalStyle: { font_family: '"JetBrains Mono", "Cascadia Code", monospace', font_size: 14, cursor_style: 'bar', cursor_color: '#0969da', selection_background: '#264f78', ligatures_enabled: false } as TerminalGlobalStyle,
  colorMode: readStorageItem('mssh:color-mode') === 'light' ? 'light' : 'dark',
  loaded: false,
  loading: false,
  error: null,
  colorModeError: null,
}

interface ThemeCatalogSnapshot {
  definitions: ThemeDefinition[]
  profiles: ThemeProfile[]
  assignments: ThemeAssignments
  globalStyle: TerminalGlobalStyle
}

interface EventEnvelope<T> { data?: T }

export const useThemeCatalogStore = create<ThemeCatalogState>(() => initialState)

let catalogRequestSequence = 0
let latestCatalogRequest = 0
let activeCatalogConsumers = 0
let catalogLifecycleSequence = 0
let colorModeOperationSequence = 0
let latestColorModeOperation = 0
let colorModeEpoch = 0
let persistedColorMode: ColorMode = initialState.colorMode
let colorModeMutationQueue = Promise.resolve()
let themeMutationQueue = Promise.resolve()

export function useThemeCatalog() {
  const state = useThemeCatalogStore()
  useEffect(() => {
    const release = retainCatalogConsumer()
    const stopCatalog = Events.On(THEME_CATALOG_CHANGED_EVENT, (event: EventEnvelope<ThemeCatalogSnapshot>) => {
      if (event.data) applyCatalogSnapshot(event.data)
    })
    const stopMode = Events.On(COLOR_MODE_CHANGED_EVENT, (event: EventEnvelope<ColorMode>) => {
      if (event.data) applySynchronizedColorMode(event.data)
    })
    const stopSync = Events.On(syncDataChangedEvent, () => { void loadThemeCatalog({ force: true }) })
    void loadThemeCatalog()
    return () => { stopCatalog(); stopMode(); stopSync(); release() }
  }, [])
  return { ...state, reload: loadThemeCatalog, setColorMode: changeColorMode, saveAssignments, saveConfiguration, saveProfile, createProfile, importThemes, deleteProfile, deleteDefinition, resetBuiltinStyles }
}

export async function loadThemeCatalog(options?: { force?: boolean; silent?: boolean }): Promise<boolean> {
  const current = useThemeCatalogStore.getState()
  if (!options?.force && (current.loading || current.loaded)) return current.loaded
  const requestId = beginCatalogRequest()
  useThemeCatalogStore.setState({ loading: true, error: null })
  try {
    await ThemeService.InitializeDefaults()
    const response = await Promise.all([ThemeService.ListDefinitions(''), ThemeService.ListProfiles(''), ThemeService.GetAssignments(), ThemeService.GetGlobalStyle(), SettingService.Get('appearance.color_mode')])
    if (!isCurrentCatalogRequest(requestId)) return useThemeCatalogStore.getState().loaded
    const [definitions, profiles, assignments, globalStyle, colorSetting] = response
    const colorMode = parseColorMode(colorSetting?.value)
    persistedColorMode = colorMode
    useThemeCatalogStore.setState({ definitions, profiles, assignments, globalStyle, colorMode, loaded: true, loading: false, colorModeError: null })
    applyInterfaceColorMode(colorMode)
    applyEffectiveTerminalTheme()
    return true
  } catch (error) {
    if (!isCurrentCatalogRequest(requestId)) return useThemeCatalogStore.getState().loaded
    const message = error instanceof Error ? error.message : String(error)
    const nextState: Partial<ThemeCatalogState> = { loading: false }
    if (!options?.silent) nextState.error = message
    useThemeCatalogStore.setState(nextState)
    logger.error('load theme catalog failed', error)
    return useThemeCatalogStore.getState().loaded
  }
}

export async function changeColorMode(nextMode: ColorMode) {
  const state = useThemeCatalogStore.getState()
  const followsInterfaceMode = state.assignments.follow_interface_mode
  const operationId = ++colorModeOperationSequence
  const operationEpoch = colorModeEpoch
  latestColorModeOperation = operationId
  invalidateCatalogRequests()
  useThemeCatalogStore.setState({ colorModeError: null })
  applyInterfaceColorMode(nextMode)
  if (followsInterfaceMode) applyEffectiveTerminalTheme()
  const operation = colorModeMutationQueue.then(() => persistColorMode(nextMode, operationId, operationEpoch))
  colorModeMutationQueue = operation.then(() => undefined, () => undefined)
  await operation
}

export async function saveAssignments(assignments: ThemeAssignments) {
  await enqueueThemeMutation(async () => {
    await ThemeService.SaveAssignments(assignments)
    useThemeCatalogStore.setState({ assignments })
    applyEffectiveTerminalTheme()
    broadcastThemeCatalog()
  })
}

export async function saveProfile(profile: ThemeProfileInput) {
  await enqueueThemeMutation(async () => {
    await ThemeService.UpdateProfile(profile)
    await refreshThemeCatalog()
  })
}

export async function createProfile(profile: ThemeProfileInput) {
  return enqueueThemeMutation(async () => {
    const created = await ThemeService.CreateCustomProfile(profile)
    await refreshThemeCatalog()
    return created
  })
}

export async function saveConfiguration(configuration: ThemeConfigurationInput) {
  await enqueueThemeMutation(async () => {
    await ThemeService.SaveConfiguration(configuration)
    await refreshThemeCatalog()
  })
}

export async function importThemes(paths: string[]): Promise<ThemeImportSummary> {
  return enqueueThemeMutation(async () => {
    const summary = await ThemeService.ImportFiles(paths)
    await refreshThemeCatalog()
    return summary
  })
}

export async function deleteProfile(id: number) {
  await enqueueThemeMutation(async () => {
    await ThemeService.DeleteProfile(id)
    await refreshThemeCatalog()
  })
}

export async function deleteDefinition(id: number) {
  await enqueueThemeMutation(async () => {
    await ThemeService.DeleteDefinition(id)
    await refreshThemeCatalog()
  })
}

export async function resetBuiltinStyles() {
  return enqueueThemeMutation(async () => {
    const result = await ThemeService.ResetBuiltinStyles()
    await refreshThemeCatalog()
    return result
  })
}

function applyInterfaceColorMode(mode: ColorMode) {
  document.documentElement.classList.toggle('light', mode === 'light')
  writeStorageItem('mssh:color-mode', mode)
  useThemeCatalogStore.setState({ colorMode: mode })
}

function applySynchronizedColorMode(mode: ColorMode) {
  colorModeEpoch += 1
  persistedColorMode = mode
  invalidateCatalogRequests()
  applyInterfaceColorMode(mode)
  if (useThemeCatalogStore.getState().assignments.follow_interface_mode) applyEffectiveTerminalTheme()
}

function applyEffectiveTerminalTheme() {
  const state = useThemeCatalogStore.getState()
  const profile = resolveEffectiveTerminalProfile(state.assignments, state.colorMode, state.profiles)
  useAppStore.getState().setTerminalTheme(profileToTerminalTheme(profile, state.globalStyle))
}

function applyCatalogSnapshot(snapshot: ThemeCatalogSnapshot) {
  invalidateCatalogRequests()
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
  // Mutations already succeeded; silent refresh failures must not rebrand them as mutation failures.
  try {
    await loadThemeCatalogFresh({ silent: true })
    broadcastThemeCatalog()
  } catch (refreshError) {
    logger.error('theme mutation post-refresh failed', refreshError)
  }
}

async function loadThemeCatalogFresh(options?: { silent?: boolean }) {
  const loaded = await loadThemeCatalog({ force: true, silent: options?.silent })
  if (!loaded) throw new Error(useThemeCatalogStore.getState().error ?? 'load theme catalog failed')
}

function retainCatalogConsumer() {
  activeCatalogConsumers += 1
  if (activeCatalogConsumers === 1) persistedColorMode = useThemeCatalogStore.getState().colorMode
  return () => {
    activeCatalogConsumers = Math.max(0, activeCatalogConsumers - 1)
    if (activeCatalogConsumers === 0) {
      catalogLifecycleSequence += 1
      invalidateCatalogRequests()
    }
  }
}

function beginCatalogRequest() {
  const requestId = ++catalogRequestSequence
  latestCatalogRequest = requestId
  return requestId
}

function invalidateCatalogRequests() {
  latestCatalogRequest = ++catalogRequestSequence
}

function isCurrentCatalogRequest(requestId: number) {
  return requestId === latestCatalogRequest
}

function enqueueThemeMutation<T>(mutation: () => Promise<T>) {
  const operation = themeMutationQueue.then(mutation, mutation)
  themeMutationQueue = operation.then(() => undefined, () => undefined)
  return operation
}

async function persistColorMode(nextMode: ColorMode, operationId: number, operationEpoch: number) {
  const rollbackMode = persistedColorMode
  try {
    await SettingService.Set({ key: 'appearance.color_mode', namespace: 'appearance', value: JSON.stringify(nextMode), value_type: 'string', version: 1 })
    persistedColorMode = nextMode
    if (operationId !== latestColorModeOperation || operationEpoch !== colorModeEpoch) return
    useThemeCatalogStore.setState({ colorModeError: null })
    emitThemeEvent(COLOR_MODE_CHANGED_EVENT, nextMode)
  } catch (error) {
    if (operationId !== latestColorModeOperation || operationEpoch !== colorModeEpoch) return
    applyInterfaceColorMode(rollbackMode)
    if (useThemeCatalogStore.getState().assignments.follow_interface_mode) applyEffectiveTerminalTheme()
    const message = error instanceof Error ? error.message : String(error)
    useThemeCatalogStore.setState({ colorModeError: t('主题设置保存失败，已恢复原主题: ${}', message) })
    logger.error('save colour mode failed', error)
  }
}

function parseColorMode(value?: string): ColorMode {
  if (!value) return readStorageItem('mssh:color-mode') === 'light' ? 'light' : 'dark'
  try { return JSON.parse(value) === 'light' ? 'light' : 'dark' } catch { return 'dark' }
}
