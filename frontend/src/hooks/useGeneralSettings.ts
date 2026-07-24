import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Events } from '@wailsio/runtime'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import { useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'
import { SETTINGS_GENERAL_CHANGED_EVENT, SETTINGS_GENERAL_PREVIEW_EVENT, SETTINGS_PREVIEW_CANCELLED_EVENT } from '@/lib/settingsWindowEvents'
import { t } from '@/i18n'
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
export {
  normalizeCloseButtonAction,
  normalizeLogDir,
  normalizeLogRetentionDays,
  normalizeProxyMode,
  normalizeProxyText,
  resolveProxyPasswordWrite,
  settingEntry,
} from '@/hooks/generalSettingsModel'

function useGeneralEvents(load: () => Promise<void>, setGeneral: Dispatch<SetStateAction<GeneralSettings>>) {
  useEffect(() => {
    const stopPreview = Events.On(SETTINGS_GENERAL_PREVIEW_EVENT, (event: EventEnvelope<GeneralPreview>) => applyPreview(event.data ?? {}))
    const stopChanged = Events.On(SETTINGS_GENERAL_CHANGED_EVENT, (event: EventEnvelope<GeneralSettings>) => {
      if (!event.data) return
      const normalized = normalizeGeneral(event.data)
      applyGeneral(normalized)
      setGeneral(normalized)
    })
    const stopCancelled = Events.On(SETTINGS_PREVIEW_CANCELLED_EVENT, () => { void load() })
    return () => { stopPreview(); stopChanged(); stopCancelled() }
  }, [load, setGeneral])
}

export function useGeneralSettings() {
  const [general, setGeneral] = useState<GeneralSettings>(defaultGeneralSettings)
  const [settingsReady, setSettingsReady] = useState(false)
  const [loadError, setLoadError] = useState('')
  const revision = useRef(0)
  const loadGeneral = useCallback(async () => {
    const currentRevision = revision.current
    try {
      const loaded = await loadPersistedGeneral()
      if (currentRevision !== revision.current) return
      applyGeneral(loaded)
      setGeneral(loaded)
      setLoadError('')
      setSettingsReady(true)
    } catch (error) {
      logger.error('loadGeneral error', error)
      setLoadError(error instanceof Error ? error.message : String(error))
      setSettingsReady(false)
    } finally {
      useTerminalBehaviorStore.getState().markSettingsHydrated()
    }
  }, [])
  const saveGeneral = useCallback(async (settings: GeneralSettings, options?: { quiet?: boolean }) => {
    const normalized = normalizeGeneral(settings)
    try {
      await persistGeneral(normalized)
      revision.current++
      const persisted = normalizeGeneral({
        ...normalized,
        proxyPassword: '',
        clearProxyPassword: false,
        proxyPasswordSaved: normalized.clearProxyPassword
          ? false
          : (normalized.proxyPasswordSaved || normalized.proxyPassword.trim() !== ''),
      })
      applyGeneral(persisted)
      setGeneral(persisted)
      emitSettingsEvent(SETTINGS_GENERAL_CHANGED_EVENT, persisted)
      if (!options?.quiet) toast(t('通用设置已保存'), 'success')
    } catch (error) {
      applyGeneral(general)
      logger.debug('saveGeneral error', error)
      // Settings panels own save failures via AutoSaveStatusIndicator / thrown errors.
      // Never error-toast here (avoids dual ownership with quiet autosave).
      throw error
    }
  }, [general])
  const previewUIFont = useCallback((family: string, fallbackFamily: string, size: number) => {
    const preview = { uiFontFamily: family, uiFontFallbackFamily: fallbackFamily, uiFontSize: size }
    applyPreview(preview)
    emitSettingsEvent(SETTINGS_GENERAL_PREVIEW_EVENT, preview)
  }, [])
  useEffect(() => { void loadGeneral() }, [loadGeneral])
  useGeneralEvents(loadGeneral, setGeneral)
  return { general, settingsReady, loadError, saveGeneral, previewUIFont, reloadGeneral: loadGeneral }
}
