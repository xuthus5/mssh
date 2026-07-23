import { useCallback, useEffect, useState } from 'react'
import { Dialogs } from '@wailsio/runtime'
import { FontService, KeyService, SyncService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import { KeyType } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { useGeneralSettings } from '@/hooks/useGeneralSettings'
import { useSFTPSettings } from '@/hooks/useSFTPSettings'
import { t } from '@/i18n'


export type { GeneralSettings } from '@/hooks/useGeneralSettings'

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

export interface KeyInfo {
  id: string
  name: string
  type: 'rsa' | 'ed25519' | 'ecdsa'
  bits: number
  publicKey: string
  createdAt: string
}

export interface KeyMaterial extends KeyInfo {
  privateKey: string
}

export interface KeyImportFile {
  name: string
  privateKey: string
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

function keyMaterial(key: { id: number; name: string; type: KeyType; private_key: string; public_key: string; created_at: string }, bits: number): KeyMaterial {
  return { ...keyInfo(key, bits), privateKey: key.private_key }
}

function keyOperationFailed(action: string, error: unknown) {
  logger.error(`${action} failed`, error)
  toast(t('${}失败: ${}', action, error instanceof Error ? error.message : String(error)), 'error')
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

export function useKeySettings() {
  const [keys, setKeys] = useState<KeyInfo[]>([])
  const listKeys = useCallback(async () => {
    try { setKeys((await KeyService.List() ?? []).map((key) => keyInfo(key, 0))) }
    catch (error) { logger.debug('listKeys error', error) }
  }, [])
  const generateKey = useCallback(async (name: string, type: KeyInfo['type'], bits: number) => {
    try {
      const keyType = ({ rsa: KeyType.KeyTypeRSA, ed25519: KeyType.KeyTypeED25519, ecdsa: KeyType.KeyTypeECDSA } as const)[type]
      const result = await KeyService.Generate(name, keyType, bits)
      if (!result) return undefined
      const material = keyMaterial(result, bits)
      setKeys((current) => [...current, keyInfo(result, bits)])
      return material
    } catch (error) { keyOperationFailed(t('生成密钥'), error); return undefined }
  }, [])
  const importKey = useCallback(async (name: string, privateKey: string) => {
    try {
      const result = await KeyService.Import(name, privateKey)
      if (!result) return undefined
      const imported = keyInfo(result, 0)
      setKeys((current) => [...current, imported])
      return imported
    } catch (error) { keyOperationFailed(t('导入密钥'), error); return undefined }
  }, [])
  const deleteKey = useCallback(async (id: string) => {
    try {
      await KeyService.Delete(Number(id))
      setKeys((current) => current.filter((key) => key.id !== id))
    } catch (error) {
      keyOperationFailed(t('删除密钥'), error)
      throw error
    }
  }, [])
  const exportKey = useCallback(async (id: string) => {
    try { return await KeyService.ExportPublicKey(Number(id)) }
    catch (error) { keyOperationFailed(t('复制公钥'), error); return undefined }
  }, [])
  const loadKeyMaterial = useCallback(async (id: string) => {
    try { const result = await KeyService.GetMaterial(Number(id)); return result ? keyMaterial(result, 0) : undefined }
    catch (error) { keyOperationFailed(t('读取密钥'), error); return undefined }
  }, [])
  const updateKey = useCallback(async (material: KeyMaterial) => {
    try {
      const result = await KeyService.Update({ id: Number(material.id), name: material.name, private_key: material.privateKey, public_key: material.publicKey })
      if (!result) return undefined
      const updated = keyMaterial(result, material.bits)
      setKeys((current) => current.map((key) => key.id === updated.id ? keyInfo(result, material.bits) : key))
      return updated
    } catch (error) { keyOperationFailed(t('更新密钥'), error); return undefined }
  }, [])
  const selectKeyImportFile = useCallback(async (): Promise<KeyImportFile | undefined> => {
    try {
      const file = await KeyService.SelectImportFile()
      return file ? { name: file.name, privateKey: file.private_key } : undefined
    } catch (error) { keyOperationFailed(t('读取私钥文件'), error); return undefined }
  }, [])
  useEffect(() => { void listKeys() }, [listKeys])
  return { keys, listKeys, generateKey, importKey, deleteKey, exportKey, loadKeyMaterial, updateKey, selectKeyImportFile }
}

function useConfigTransfer() {
  const exportConfig = useCallback(async () => {
    try {
      const path = await Dialogs.SaveFile({ Title: t('导出 MSSH 加密备份'), Filename: 'mssh-backup.msshbackup', CanCreateDirectories: true, Filters: [{ DisplayName: 'MSSH Backup', Pattern: '*.msshbackup' }] })
      if (!path) return
      await SyncService.Export(path)
      toast(t('本地备份已导出'), 'success')
    } catch (error) {
      keyOperationFailed(t('导出本地备份'), error)
      throw error
    }
  }, [])
  const importConfig = useCallback(async () => {
    try {
      const selected = await Dialogs.OpenFile({ Title: t('导入 MSSH 加密备份'), CanChooseFiles: true, AllowsMultipleSelection: false, Filters: [{ DisplayName: 'MSSH Backup', Pattern: '*.msshbackup' }] })
      const path = typeof selected === 'string' ? selected : selected[0]
      if (!path) return
      await SyncService.Import(path)
      toast(t('本地备份已导入'), 'success')
    } catch (error) {
      keyOperationFailed(t('导入本地备份'), error)
      throw error
    }
  }, [])
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
    sftpSettings: sftp.settings, saveSFTPSettings: sftp.save,
    systemFonts,
  }
}
