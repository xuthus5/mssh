import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Dialogs } from '@wailsio/runtime'
import { FontService, SyncService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import { useGeneralSettings } from '@/hooks/useGeneralSettings'
import { useSFTPSettings } from '@/hooks/useSFTPSettings'
import { useKeySettingsRuntime } from '@/hooks/keySettingsRuntime'
import { useSettingsWindowHide } from '@/hooks/useSettingsWindowHide'
import { t } from '@/i18n'


export type { GeneralSettings, GeneralSettingsSaveOptions } from '@/hooks/useGeneralSettings'

export interface TerminalTheme {
  background: string
  foreground: string
  cursorColor: string
  selectionBackground: string
  cursorStyle: 'block' | 'underline' | 'bar'
  fontFamily: string
  fontSize: number
  ansi: string[]
}

export type { KeyImportFile, KeyInfo, KeyMaterial } from '@/hooks/keySettingsRuntime'

function rethrowKeyError(action: string, error: unknown): never {
  logger.error(`${action} failed`, error)
  throw error instanceof Error ? error : new Error(String(error))
}

type ConfigTransferPhase = 'idle' | 'picker' | 'transfer'

function useConfigTransferRuntime() {
  const lifecycle = useRef(0)
  const requestID = useRef(0)
  const windowGeneration = useRef(0)
  const active = useRef(false)
  const phase = useRef<ConfigTransferPhase>('idle')
  useEffect(() => {
    const token = ++lifecycle.current
    return () => {
      if (lifecycle.current === token) lifecycle.current++
    }
  }, [])
  useSettingsWindowHide(() => {
    if (phase.current !== 'picker') return
    windowGeneration.current++
  })
  return useMemo(() => ({ lifecycle, requestID, windowGeneration, active, phase }), [])
}

type ConfigTransferRuntime = ReturnType<typeof useConfigTransferRuntime>

function beginConfigTransfer(runtime: ConfigTransferRuntime) {
  if (runtime.active.current) return 0
  runtime.active.current = true
  runtime.phase.current = 'picker'
  return ++runtime.requestID.current
}

function finishConfigTransfer(runtime: ConfigTransferRuntime, request: number) {
  if (runtime.requestID.current !== request) return
  runtime.active.current = false
  runtime.phase.current = 'idle'
}

async function runConfigTransfer(options: {
  runtime: ConfigTransferRuntime
  selectPath: () => Promise<string>
  transfer: (path: string) => Promise<void>
  success: string
  action: string
}) {
  const request = beginConfigTransfer(options.runtime)
  if (request === 0) return
  const lifecycleToken = options.runtime.lifecycle.current
  const windowToken = options.runtime.windowGeneration.current
  const isCurrent = () => options.runtime.lifecycle.current === lifecycleToken
    && options.runtime.requestID.current === request && options.runtime.windowGeneration.current === windowToken
  let transferStarted = false
  try {
    const path = await options.selectPath()
    if (!path || !isCurrent()) return
    transferStarted = true
    options.runtime.phase.current = 'transfer'
    await options.transfer(path)
    if (isCurrent()) toast(options.success, 'success')
  } catch (error) {
    if (!transferStarted && !isCurrent()) return
    rethrowKeyError(options.action, error)
  } finally {
    finishConfigTransfer(options.runtime, request)
  }
}

function useSystemFonts() {
  const [systemFonts, setSystemFonts] = useState<string[]>([])
  useEffect(() => {
    let active = true
    void FontService.List().then((fonts) => {
      if (active) setSystemFonts(fonts ?? [])
    }).catch((error: unknown) => {
      logger.debug('loadSystemFonts error', error)
      if (active) setSystemFonts(['sans-serif'])
    })
    return () => { active = false }
  }, [])
  return systemFonts
}

export function useKeySettings() {
  return useKeySettingsRuntime()
}

function useConfigTransfer() {
  const runtime = useConfigTransferRuntime()
  const exportConfig = useCallback(() => runConfigTransfer({
    runtime,
    selectPath: async () => await Dialogs.SaveFile({ Title: t('导出 MSSH 加密备份'), Filename: 'mssh-backup.msshbackup', CanCreateDirectories: true, Filters: [{ DisplayName: 'MSSH Backup', Pattern: '*.msshbackup' }] }) ?? '',
    transfer: (path) => SyncService.Export(path), success: t('本地备份已导出'), action: t('导出本地备份'),
  }), [runtime])
  const importConfig = useCallback(() => runConfigTransfer({
    runtime,
    selectPath: async () => {
      const selected = await Dialogs.OpenFile({ Title: t('导入 MSSH 加密备份'), CanChooseFiles: true, AllowsMultipleSelection: false, Filters: [{ DisplayName: 'MSSH Backup', Pattern: '*.msshbackup' }] })
      return typeof selected === 'string' ? selected : selected?.[0] ?? ''
    },
    transfer: (path) => SyncService.Import(path), success: t('本地备份已导入'), action: t('导入本地备份'),
  }), [runtime])
  return { exportConfig, importConfig }
}

export function useSettings() {
  const general = useGeneralSettings()
  const keys = useKeySettings()
  const config = useConfigTransfer()
  const sftp = useSFTPSettings()
  const systemFonts = useSystemFonts()
  return {
    ...general,
    ...keys,
    ...config,
    sftpSettings: sftp.settings,
    sftpSettingsReady: sftp.settingsReady,
    sftpLoadError: sftp.loadError,
    reloadSFTPSettings: sftp.reload,
    saveSFTPSettings: sftp.save,
    systemFonts,
  }
}
