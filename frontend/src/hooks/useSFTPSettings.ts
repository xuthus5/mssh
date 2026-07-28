import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Events } from '@wailsio/runtime'
import { SettingService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import { settingEntry } from '@/hooks/useGeneralSettings'
import { SETTINGS_SFTP_CHANGED_EVENT } from '@/lib/settingsWindowEvents'
import { useSFTPSettingsStore } from '@/store/sftpSettingsStore'
import { DEFAULT_SFTP_SETTINGS, type SFTPSettings } from '@/lib/sftpSettings'
import type { Setting } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'
import { syncDataChangedEvent } from '@/lib/syncDataReload'


const sftpSettingKeys = ['sftp.show_hidden_files', 'sftp.follow_terminal_directory', 'sftp.default_view']

export type { SFTPDefaultView, SFTPSettings } from '@/lib/sftpSettings'

interface EventEnvelope<T> { data?: T }

function settingValue<T>(settings: { [_ in string]?: Setting }, key: string, fallback: T): T {
  const setting = settings[key]
  if (!setting) return fallback
  try { return JSON.parse(setting.value) as T } catch { return fallback }
}

export function normalizeSFTPSettings(settings: Partial<SFTPSettings>): SFTPSettings {
  return {
    showHiddenFiles: settings.showHiddenFiles === true,
    followTerminalDirectory: settings.followTerminalDirectory === true,
    defaultView: settings.defaultView === 'tree' ? 'tree' : 'list',
  }
}

function parseSFTPSettings(settings: { [_ in string]?: Setting }): SFTPSettings {
  return normalizeSFTPSettings({
    showHiddenFiles: settingValue(settings, 'sftp.show_hidden_files', DEFAULT_SFTP_SETTINGS.showHiddenFiles),
    followTerminalDirectory: settingValue(settings, 'sftp.follow_terminal_directory', DEFAULT_SFTP_SETTINGS.followTerminalDirectory),
    defaultView: settingValue(settings, 'sftp.default_view', DEFAULT_SFTP_SETTINGS.defaultView),
  })
}

function emitSFTPSettings(settings: SFTPSettings) {
  void Events.Emit(SETTINGS_SFTP_CHANGED_EVENT, settings).catch((error: unknown) => logger.error('emit SFTP settings failed', error))
}

function useSFTPRuntime() {
  const revision = useRef(0)
  const lifecycle = useRef(0)
  const requestID = useRef(0)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => {
      if (lifecycle.current === token) lifecycle.current++
    }
  }, [])
  return useMemo(() => ({ revision, lifecycle, requestID }), [])
}

function publishSFTPSettings(settings: SFTPSettings, setSettings: (settings: SFTPSettings) => void) {
  setSettings(settings)
  useSFTPSettingsStore.getState().setSettings(settings)
}

function useSFTPLoad(options: {
  runtime: ReturnType<typeof useSFTPRuntime>
  setSettings: (settings: SFTPSettings) => void
  setSettingsReady: (ready: boolean) => void
  setLoadError: (error: string) => void
}) {
  const { runtime, setSettings, setSettingsReady, setLoadError } = options
  return useCallback(async () => {
    const { lifecycle, requestID, revision } = runtime
    const lifecycleToken = lifecycle.current
    const currentRequest = ++requestID.current
    const currentRevision = revision.current
    const isCurrent = () => lifecycle.current === lifecycleToken
      && requestID.current === currentRequest && revision.current === currentRevision
    try {
      const persisted = parseSFTPSettings(await SettingService.GetMany(sftpSettingKeys))
      if (!isCurrent()) return
      publishSFTPSettings(persisted, setSettings)
      setLoadError('')
      setSettingsReady(true)
    } catch (error) {
      if (!isCurrent()) return
      logger.error('loadSFTPSettings error', error)
      setLoadError(error instanceof Error ? error.message : String(error))
      setSettingsReady(false)
    }
  }, [runtime, setLoadError, setSettings, setSettingsReady])
}

function useSFTPSave(runtime: ReturnType<typeof useSFTPRuntime>, setSettings: (settings: SFTPSettings) => void) {
  return useCallback(async (next: SFTPSettings, options?: { quiet?: boolean }) => {
    const normalized = normalizeSFTPSettings(next)
    try {
      await SettingService.SetMany([
        settingEntry('sftp.show_hidden_files', normalized.showHiddenFiles),
        settingEntry('sftp.follow_terminal_directory', normalized.followTerminalDirectory),
        settingEntry('sftp.default_view', normalized.defaultView),
      ])
      runtime.revision.current++
      runtime.requestID.current++
      publishSFTPSettings(normalized, setSettings)
      emitSFTPSettings(normalized)
      if (!options?.quiet) toast(t('SFTP 设置已保存'), 'success')
    } catch (error) {
      logger.debug('saveSFTPSettings error', error)
      // Settings panels own save failures via AutoSaveStatusIndicator / thrown errors.
      throw error
    }
  }, [runtime, setSettings])
}

function useSFTPEventSync(runtime: ReturnType<typeof useSFTPRuntime>, setSettings: (settings: SFTPSettings) => void, reload: () => Promise<void>) {
  useEffect(() => {
    const stopChanged = Events.On(SETTINGS_SFTP_CHANGED_EVENT, (event: EventEnvelope<SFTPSettings>) => {
      if (!event.data) return
      runtime.revision.current++
      runtime.requestID.current++
      publishSFTPSettings(normalizeSFTPSettings(event.data), setSettings)
    })
    const stopSync = Events.On(syncDataChangedEvent, () => { void reload() })
    return () => { stopChanged(); stopSync() }
  }, [reload, runtime, setSettings])
}

export function useSFTPSettings() {
  const [settings, setSettings] = useState<SFTPSettings>(DEFAULT_SFTP_SETTINGS)
  const [settingsReady, setSettingsReady] = useState(false)
  const [loadError, setLoadError] = useState('')
  const runtime = useSFTPRuntime()
  const load = useSFTPLoad({ runtime, setSettings, setSettingsReady, setLoadError })
  const save = useSFTPSave(runtime, setSettings)
  useEffect(() => { void load() }, [load])
  useSFTPEventSync(runtime, setSettings, load)
  return { settings, settingsReady, loadError, save, reload: load }
}
