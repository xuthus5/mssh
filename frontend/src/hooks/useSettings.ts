import { useCallback, useEffect, useRef, useState } from 'react'
import { Dialogs } from '@wailsio/runtime'
import { FontService, KeyService, SettingService, SyncService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { KeyType } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { settingEntry, useGeneralSettings } from '@/hooks/useGeneralSettings'

export type { GeneralSettings } from '@/hooks/useGeneralSettings'

export interface TerminalTheme {
  background: string
  foreground: string
  cursorColor: string
  cursorStyle: 'block' | 'underline' | 'bar'
  fontFamily: string
  fontSize: number
  ansi: string[]
}

export interface KeyInfo {
  id: string
  name: string
  type: 'rsa' | 'ed25519' | 'ecdsa'
  bits: number
  publicKey: string
  createdAt: string
}

export interface SyncConfig {
  enabled: boolean
  url: string
  username: string
  password: string
}

function keyTypeName(type: KeyType): KeyInfo['type'] {
  return ({
    [KeyType.KeyTypeRSA]: 'rsa',
    [KeyType.KeyTypeED25519]: 'ed25519',
    [KeyType.KeyTypeECDSA]: 'ecdsa',
  } as Record<string, KeyInfo['type']>)[String(type)] ?? 'ed25519'
}

function keyInfo(key: { id: number; name: string; type: KeyType; public_key: string; created_at: string }, bits: number): KeyInfo {
  return { id: String(key.id), name: key.name, type: keyTypeName(key.type), bits, publicKey: key.public_key, createdAt: key.created_at }
}

function useSystemFonts() {
  const [systemFonts, setSystemFonts] = useState<string[]>([])
  const loadSystemFonts = useCallback(async () => {
    try { setSystemFonts(await FontService.List()) }
    catch (error) { logger.debug('loadSystemFonts error', error); setSystemFonts(['sans-serif']) }
  }, [])
  useEffect(() => { void loadSystemFonts() }, [loadSystemFonts])
  return systemFonts
}

function useKeySettings() {
  const [keys, setKeys] = useState<KeyInfo[]>([])
  const listKeys = useCallback(async () => {
    try { setKeys((await KeyService.List() ?? []).map((key) => keyInfo(key, 0))) }
    catch (error) { logger.debug('listKeys error', error) }
  }, [])
  const generateKey = useCallback(async (name: string, type: KeyInfo['type'], bits: number) => {
    try {
      const keyType = ({ rsa: KeyType.KeyTypeRSA, ed25519: KeyType.KeyTypeED25519, ecdsa: KeyType.KeyTypeECDSA } as const)[type]
      const result = await KeyService.Generate(name, keyType, bits)
      if (result) setKeys((current) => [...current, keyInfo(result, bits)])
    } catch (error) { logger.debug('generateKey error', error) }
  }, [])
  const importKey = useCallback(async (name: string, privateKey: string) => {
    try {
      const result = await KeyService.Import(name, privateKey)
      if (result) setKeys((current) => [...current, keyInfo(result, 0)])
    } catch (error) { logger.debug('importKey error', error) }
  }, [])
  const deleteKey = useCallback(async (id: string) => {
    try { await KeyService.Delete(Number(id)); setKeys((current) => current.filter((key) => key.id !== id)) }
    catch (error) { logger.debug('deleteKey error', error) }
  }, [])
  const exportKey = useCallback(async (id: string) => {
    try { return await KeyService.ExportPublicKey(Number(id)) }
    catch (error) { logger.debug('exportKey error', error); return undefined }
  }, [])
  useEffect(() => { void listKeys() }, [listKeys])
  return { keys, listKeys, generateKey, importKey, deleteKey, exportKey }
}

function useSyncSettings() {
  const [sync, setSync] = useState<SyncConfig>({ enabled: false, url: '', username: '', password: '' })
  const revision = useRef(0)
  const saveSync = useCallback(async (config: SyncConfig) => {
    try {
      revision.current++
      await SettingService.SetMany([settingEntry('sync.enabled', config.enabled), settingEntry('sync.url', config.url), settingEntry('sync.username', config.username)])
      setSync(config)
    } catch (error) { logger.debug('saveSync error', error) }
  }, [])
  const loadSync = useCallback(async () => {
    try {
      const currentRevision = revision.current
      const settings = await SettingService.GetMany(['sync.enabled', 'sync.url', 'sync.username'])
      const value = <T,>(key: string, fallback: T) => settings[key] ? JSON.parse(settings[key].value) as T : fallback
      if (currentRevision === revision.current) setSync({ enabled: value('sync.enabled', false), url: value('sync.url', ''), username: value('sync.username', ''), password: '' })
    } catch (error) { logger.debug('loadSync error', error) }
  }, [])
  useEffect(() => { void loadSync() }, [loadSync])
  return { sync, saveSync }
}

function useConfigTransfer() {
  const exportConfig = useCallback(async () => {
    try {
      const path = await Dialogs.SaveFile({ Title: '导出 MSSH 配置', Filename: 'mssh-export.json', CanCreateDirectories: true })
      if (path) await SyncService.Export(path)
    } catch (error) { logger.debug('exportConfig error', error) }
  }, [])
  const importConfig = useCallback(async () => {
    try {
      const selected = await Dialogs.OpenFile({ Title: '导入 MSSH 配置', CanChooseFiles: true, AllowsMultipleSelection: false, Filters: [{ DisplayName: 'JSON', Pattern: '*.json' }] })
      const path = typeof selected === 'string' ? selected : selected[0]
      if (path) await SyncService.Import(path)
    } catch (error) { logger.debug('importConfig error', error) }
  }, [])
  return { exportConfig, importConfig }
}

export function useSettings() {
  const general = useGeneralSettings()
  const keys = useKeySettings()
  const sync = useSyncSettings()
  const config = useConfigTransfer()
  const systemFonts = useSystemFonts()
  return {
    ...general,
    ...keys,
    ...sync,
    ...config,
    systemFonts,
  }
}
