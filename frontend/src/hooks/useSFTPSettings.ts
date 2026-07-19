import { useCallback, useEffect, useRef, useState } from 'react'
import { Events } from '@wailsio/runtime'
import { SettingService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import { settingEntry } from '@/hooks/useGeneralSettings'
import { SETTINGS_SFTP_CHANGED_EVENT } from '@/lib/settingsWindowEvents'
import { useSFTPSettingsStore } from '@/store/sftpSettingsStore'
import { DEFAULT_SFTP_SETTINGS, type SFTPSettings } from '@/lib/sftpSettings'
import type { Setting } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'

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

export function useSFTPSettings() {
  const [settings, setSettings] = useState<SFTPSettings>(DEFAULT_SFTP_SETTINGS)
  const revision = useRef(0)
  const load = useCallback(async () => {
    const currentRevision = revision.current
    try {
      const persisted = parseSFTPSettings(await SettingService.GetMany(sftpSettingKeys))
      if (currentRevision === revision.current) { setSettings(persisted); useSFTPSettingsStore.getState().setSettings(persisted) }
    } catch (error) { logger.debug('loadSFTPSettings error', error) }
  }, [])
  const save = useCallback(async (next: SFTPSettings) => {
    const normalized = normalizeSFTPSettings(next)
    try {
      await SettingService.SetMany([
        settingEntry('sftp.show_hidden_files', normalized.showHiddenFiles),
        settingEntry('sftp.follow_terminal_directory', normalized.followTerminalDirectory),
        settingEntry('sftp.default_view', normalized.defaultView),
      ])
      revision.current++
      setSettings(normalized)
      useSFTPSettingsStore.getState().setSettings(normalized)
      emitSFTPSettings(normalized)
      toast('SFTP 设置已保存', 'success')
    } catch (error) {
      logger.debug('saveSFTPSettings error', error)
      toast(`保存 SFTP 设置失败: ${error instanceof Error ? error.message : String(error)}`, 'error')
      throw error
    }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => Events.On(SETTINGS_SFTP_CHANGED_EVENT, (event: EventEnvelope<SFTPSettings>) => {
    if (event.data) { const normalized = normalizeSFTPSettings(event.data); setSettings(normalized); useSFTPSettingsStore.getState().setSettings(normalized) }
  }), [])
  return { settings, save, reload: load }
}
