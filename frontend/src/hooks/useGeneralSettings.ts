import { useCallback, useEffect, useRef, useState } from 'react'
import { Events } from '@wailsio/runtime'
import { TerminalService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import { useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'
import { SETTINGS_GENERAL_CHANGED_EVENT, SETTINGS_GENERAL_PREVIEW_EVENT, SETTINGS_PREVIEW_CANCELLED_EVENT } from '@/lib/settingsWindowEvents'
import { t } from '@/i18n'
import { syncDataChangedEvent } from '@/lib/syncDataReload'
import {
  applyGeneral,
  applyPreview,
  defaultGeneralSettings,
  emitSettingsEvent,
  loadPersistedGeneral,
  normalizeGeneral,
  persistGeneral,
  type GeneralPreview,
  type GeneralSettings,
  type EventEnvelope,
} from '@/hooks/generalSettingsModel'

export type {
  CloseButtonAction,
  GeneralSettings,
  NetworkProxyMode,
} from '@/hooks/generalSettingsModel'

export type GeneralSettingsSaveScope = 'all' | 'general' | 'terminal'

export interface GeneralSettingsSaveOptions {
  quiet?: boolean
  scope?: GeneralSettingsSaveScope
}

export {
  DEFAULT_TERMINAL_POOL_SIZE,
  normalizeCloseButtonAction,
  normalizeDebug,
  normalizeLogDir,
  normalizeLogRetentionDays,
  normalizeMaxPoolSize,
  normalizeProxyMode,
  normalizeProxyText,
  resolveProxyPasswordWrite,
  settingEntry,
} from '@/hooks/generalSettingsModel'

function mergeGeneralScope(current: GeneralSettings, next: GeneralSettings): GeneralSettings {
  return {
    ...current,
    uiFontFamily: next.uiFontFamily,
    uiFontFallbackFamily: next.uiFontFallbackFamily,
    uiFontSize: next.uiFontSize,
    closeButtonAction: next.closeButtonAction,
    debug: next.debug,
    logDir: next.logDir,
    logRetentionDays: next.logRetentionDays,
    proxyMode: next.proxyMode,
    proxyURL: next.proxyURL,
    proxyNoProxy: next.proxyNoProxy,
    proxyUsername: next.proxyUsername,
    proxyPassword: next.proxyPassword,
    proxyPasswordSaved: next.proxyPasswordSaved,
    clearProxyPassword: next.clearProxyPassword,
    language: next.language,
  }
}

function mergeTerminalScope(current: GeneralSettings, next: GeneralSettings): GeneralSettings {
  return {
    ...current,
    maxPoolSize: next.maxPoolSize,
    defaultKeepAlive: next.defaultKeepAlive,
    defaultTermType: next.defaultTermType,
    rightClickAction: next.rightClickAction,
    copyOnSelect: next.copyOnSelect,
    scrollbackLines: next.scrollbackLines,
    autoReconnect: next.autoReconnect,
    restoreTabsOnStartup: next.restoreTabsOnStartup,
    renderer: next.renderer,
    historyPredict: next.historyPredict,
    localShell: next.localShell,
    localShellArgs: next.localShellArgs,
    localShellCwd: next.localShellCwd,
    localShellLogin: next.localShellLogin,
    keywordHighlightEnabled: next.keywordHighlightEnabled,
    keywordHighlightCaseInsensitive: next.keywordHighlightCaseInsensitive,
    keywordHighlightRules: next.keywordHighlightRules,
  }
}

function mergeSaveScope(current: GeneralSettings, next: GeneralSettings, scope: GeneralSettingsSaveScope): GeneralSettings {
  if (scope === 'general') return mergeGeneralScope(current, next)
  if (scope === 'terminal') return mergeTerminalScope(current, next)
  return next
}

interface GeneralEventsOptions {
  load: () => Promise<void>
  commitGeneral: (settings: GeneralSettings) => void
  invalidateLoads: () => void
  applyPoolSize: (size: number) => Promise<void>
}

function useGeneralEvents({ load, commitGeneral, invalidateLoads, applyPoolSize }: GeneralEventsOptions) {
  useEffect(() => {
    const stopPreview = Events.On(SETTINGS_GENERAL_PREVIEW_EVENT, (event: EventEnvelope<GeneralPreview>) => applyPreview(event.data ?? {}))
    const stopChanged = Events.On(SETTINGS_GENERAL_CHANGED_EVENT, (event: EventEnvelope<GeneralSettings>) => {
      if (!event.data) return
      invalidateLoads()
      const normalized = normalizeGeneral(event.data)
      applyGeneral(normalized)
      commitGeneral(normalized)
      void applyPoolSize(normalized.maxPoolSize).catch((error: unknown) => logger.error('apply general runtime settings failed', error))
    })
    const stopCancelled = Events.On(SETTINGS_PREVIEW_CANCELLED_EVENT, () => { void load() })
    const stopSync = Events.On(syncDataChangedEvent, () => { void load() })
    return () => { stopPreview(); stopChanged(); stopCancelled(); stopSync() }
  }, [applyPoolSize, commitGeneral, invalidateLoads, load])
}

function useGeneralState() {
  const [general, setGeneral] = useState<GeneralSettings>(defaultGeneralSettings)
  const generalRef = useRef(general)
  const commitGeneral = useCallback((next: GeneralSettings) => {
    generalRef.current = next
    setGeneral(next)
  }, [])
  const [settingsReady, setSettingsReady] = useState(false)
  const [loadError, setLoadError] = useState('')
  return { general, generalRef, commitGeneral, settingsReady, setSettingsReady, loadError, setLoadError }
}

type GeneralState = ReturnType<typeof useGeneralState>

function useGeneralRequests() {
  const revision = useRef(0)
  const lifecycle = useRef(0)
  const requestID = useRef(0)
  const invalidateLoads = useCallback(() => {
    revision.current++
    requestID.current++
  }, [])
  useEffect(() => {
    const token = ++lifecycle.current
    return () => {
      if (lifecycle.current === token) lifecycle.current++
    }
  }, [])
  return { revision, lifecycle, requestID, invalidateLoads }
}

type GeneralRequests = ReturnType<typeof useGeneralRequests>

function usePoolSizeRuntime() {
  const poolUpdateRequest = useRef(0)
  const poolUpdateQueue = useRef(Promise.resolve())
  return useCallback((size: number) => {
    const request = ++poolUpdateRequest.current
    const update = poolUpdateQueue.current
      .catch(() => undefined)
      .then(async () => {
        if (request !== poolUpdateRequest.current) return
        await TerminalService.SetMaxSize(size)
      })
    poolUpdateQueue.current = update.catch(() => undefined)
    return update
  }, [])
}

function useGeneralLoader(state: GeneralState, requests: GeneralRequests, applyPoolSize: (size: number) => Promise<void>) {
  const { commitGeneral, setLoadError, setSettingsReady } = state
  const { lifecycle, requestID, revision } = requests
  return useCallback(async () => {
    const lifecycleToken = lifecycle.current
    const currentRequest = ++requestID.current
    const currentRevision = revision.current
    const isCurrent = () => lifecycle.current === lifecycleToken
      && requestID.current === currentRequest
      && currentRevision === revision.current
    try {
      const loaded = await loadPersistedGeneral()
      if (!isCurrent()) return
      await applyPoolSize(loaded.maxPoolSize)
      if (!isCurrent()) return
      applyGeneral(loaded)
      commitGeneral(loaded)
      setLoadError('')
      setSettingsReady(true)
    } catch (error) {
      if (!isCurrent()) return
      logger.error('loadGeneral error', error)
      setLoadError(error instanceof Error ? error.message : String(error))
      setSettingsReady(false)
    } finally {
      if (isCurrent()) useTerminalBehaviorStore.getState().markSettingsHydrated()
    }
  }, [applyPoolSize, commitGeneral, lifecycle, requestID, revision, setLoadError, setSettingsReady])
}

function persistedGeneral(settings: GeneralSettings): GeneralSettings {
  return normalizeGeneral({
    ...settings,
    proxyPassword: '',
    clearProxyPassword: false,
    proxyPasswordSaved: settings.clearProxyPassword
      ? false
      : (settings.proxyPasswordSaved || settings.proxyPassword !== ''),
  })
}

function useGeneralSaver(state: GeneralState, requests: GeneralRequests) {
  const saveRequest = useRef(0)
  const saveQueue = useRef(Promise.resolve())
  const { commitGeneral, generalRef } = state
  const { invalidateLoads } = requests
  return useCallback((settings: GeneralSettings, options?: GeneralSettingsSaveOptions) => {
    const requested = normalizeGeneral(settings)
    const request = ++saveRequest.current
    const save = async () => {
      try {
        const normalized = normalizeGeneral(mergeSaveScope(generalRef.current, requested, options?.scope ?? 'all'))
        await persistGeneral(normalized)
        invalidateLoads()
        const persisted = persistedGeneral(normalized)
        applyGeneral(persisted)
        commitGeneral(persisted)
        emitSettingsEvent(SETTINGS_GENERAL_CHANGED_EVENT, persisted)
        if (!options?.quiet) toast(t('通用设置已保存'), 'success')
      } catch (error) {
        if (request === saveRequest.current) applyGeneral(generalRef.current)
        logger.debug('saveGeneral error', error)
        throw error
      }
    }
    const queued = saveQueue.current.catch(() => undefined).then(save)
    saveQueue.current = queued.catch(() => undefined)
    return queued
  }, [commitGeneral, generalRef, invalidateLoads])
}

export function useGeneralSettings() {
  const state = useGeneralState()
  const requests = useGeneralRequests()
  const applyPoolSize = usePoolSizeRuntime()
  const loadGeneral = useGeneralLoader(state, requests, applyPoolSize)
  const saveGeneral = useGeneralSaver(state, requests)
  const previewUIFont = useCallback((family: string, fallbackFamily: string, size: number) => {
    const preview = { uiFontFamily: family, uiFontFallbackFamily: fallbackFamily, uiFontSize: size }
    applyPreview(preview)
    emitSettingsEvent(SETTINGS_GENERAL_PREVIEW_EVENT, preview)
  }, [])
  useEffect(() => { void loadGeneral() }, [loadGeneral])
  useGeneralEvents({ load: loadGeneral, commitGeneral: state.commitGeneral, invalidateLoads: requests.invalidateLoads, applyPoolSize })
  return {
    general: state.general, settingsReady: state.settingsReady, loadError: state.loadError,
    saveGeneral, previewUIFont, reloadGeneral: loadGeneral,
  }
}
