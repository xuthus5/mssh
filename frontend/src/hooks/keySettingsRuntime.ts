import { useCallback, useEffect, useRef, useState } from 'react'
import { Events } from '@wailsio/runtime'
import { KeyService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { t } from '@/i18n'
import { syncDataChangedEvent } from '@/lib/syncDataReload'
import { KeyType } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'

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

interface StoredKey {
  id: number
  name: string
  type: KeyType
  public_key: string
  created_at: string
}

interface StoredKeyMaterial extends StoredKey {
  private_key: string
}

function keyTypeName(type: KeyType): KeyInfo['type'] {
  return ({
    [KeyType.KeyTypeRSA]: 'rsa',
    [KeyType.KeyTypeED25519]: 'ed25519',
    [KeyType.KeyTypeECDSA]: 'ecdsa',
  } as Record<string, KeyInfo['type']>)[String(type)] ?? 'ed25519'
}

function keyInfo(key: StoredKey, bits: number): KeyInfo {
  return { id: String(key.id), name: key.name, type: keyTypeName(key.type), bits, publicKey: key.public_key, createdAt: key.created_at }
}

function keyMaterial(key: StoredKeyMaterial, bits: number): KeyMaterial {
  return { ...keyInfo(key, bits), privateKey: key.private_key }
}

function upsertKey(keys: KeyInfo[], next: KeyInfo): KeyInfo[] {
  return keys.some((key) => key.id === next.id)
    ? keys.map((key) => key.id === next.id ? next : key)
    : [...keys, next]
}

function rethrowKeyError(action: string, error: unknown): never {
  logger.error(`${action} failed`, error)
  throw error instanceof Error ? error : new Error(String(error))
}

function useKeyRuntime() {
  const lifecycle = useRef(0)
  const active = useRef(false)
  const listRequest = useRef(0)
  const listInFlight = useRef(0)
  useEffect(() => {
    active.current = true
    const token = ++lifecycle.current
    return () => {
      active.current = false
      if (lifecycle.current === token) lifecycle.current++
    }
  }, [])
  return { lifecycle, active, listRequest, listInFlight }
}

type KeyRuntime = ReturnType<typeof useKeyRuntime>

function useKeyCollection(runtime: KeyRuntime) {
  const [keys, setKeys] = useState<KeyInfo[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const { active, lifecycle, listInFlight, listRequest } = runtime
  const listKeys = useCallback(async () => {
    if (!active.current) return
    const lifecycleToken = lifecycle.current
    const currentRequest = ++listRequest.current
    const isCurrent = () => active.current && lifecycle.current === lifecycleToken && listRequest.current === currentRequest
    listInFlight.current++
    setLoading(true)
    try {
      const nextKeys = (await KeyService.List() ?? []).map((key) => keyInfo(key, 0))
      if (!isCurrent()) return
      setKeys(nextKeys)
      setError('')
    } catch (loadError) {
      if (!isCurrent()) return
      logger.error('listKeys error', loadError)
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      listInFlight.current--
      if (isCurrent()) setLoading(false)
    }
  }, [active, lifecycle, listInFlight, listRequest])
  useEffect(() => {
    void listKeys()
    return Events.On(syncDataChangedEvent, () => { void listKeys() })
  }, [listKeys])
  return { keys, setKeys, error, setError, loading, listKeys }
}

type KeyCollection = ReturnType<typeof useKeyCollection>
type CommitMutation = (lifecycleToken: number, update: (current: KeyInfo[]) => KeyInfo[]) => void

function useCommitMutation(runtime: KeyRuntime, collection: KeyCollection): CommitMutation {
  const { active, lifecycle, listInFlight, listRequest } = runtime
  const { listKeys, setError, setKeys } = collection
  return useCallback((lifecycleToken, update) => {
    if (!active.current || lifecycle.current !== lifecycleToken) return
    const shouldReload = listInFlight.current > 0
    listRequest.current++
    setKeys(update)
    setError('')
    if (shouldReload) void listKeys()
  }, [active, lifecycle, listInFlight, listKeys, listRequest, setError, setKeys])
}

function useKeyCreateActions(runtime: KeyRuntime, commitMutation: CommitMutation) {
  const generateKey = useCallback(async (name: string, type: KeyInfo['type'], bits: number) => {
    const lifecycleToken = runtime.lifecycle.current
    try {
      const keyType = ({ rsa: KeyType.KeyTypeRSA, ed25519: KeyType.KeyTypeED25519, ecdsa: KeyType.KeyTypeECDSA } as const)[type]
      const result = await KeyService.Generate(name, keyType, bits)
      if (!result) return undefined
      commitMutation(lifecycleToken, (current) => upsertKey(current, keyInfo(result, bits)))
      return keyMaterial(result, bits)
    } catch (error) { rethrowKeyError(t('生成密钥'), error) }
  }, [commitMutation, runtime.lifecycle])
  const importKey = useCallback(async (name: string, privateKey: string) => {
    const lifecycleToken = runtime.lifecycle.current
    try {
      const result = await KeyService.Import(name, privateKey)
      if (!result) return undefined
      const imported = keyInfo(result, 0)
      commitMutation(lifecycleToken, (current) => upsertKey(current, imported))
      return imported
    } catch (error) { rethrowKeyError(t('导入密钥'), error) }
  }, [commitMutation, runtime.lifecycle])
  return { generateKey, importKey }
}

function useKeyManageActions(runtime: KeyRuntime, commitMutation: CommitMutation) {
  const deleteKey = useCallback(async (id: string) => {
    const lifecycleToken = runtime.lifecycle.current
    try {
      await KeyService.Delete(Number(id))
      commitMutation(lifecycleToken, (current) => current.filter((key) => key.id !== id))
    } catch (error) { rethrowKeyError(t('删除密钥'), error) }
  }, [commitMutation, runtime.lifecycle])
  const updateKey = useCallback(async (material: KeyMaterial) => {
    const lifecycleToken = runtime.lifecycle.current
    try {
      const result = await KeyService.Update({ id: Number(material.id), name: material.name, private_key: material.privateKey, public_key: material.publicKey })
      if (!result) return undefined
      commitMutation(lifecycleToken, (current) => upsertKey(current, keyInfo(result, material.bits)))
      return keyMaterial(result, material.bits)
    } catch (error) { rethrowKeyError(t('更新密钥'), error) }
  }, [commitMutation, runtime.lifecycle])
  return { deleteKey, updateKey }
}

function useKeyReadActions() {
  const exportKey = useCallback(async (id: string) => {
    try { return await KeyService.ExportPublicKey(Number(id)) }
    catch (error) { rethrowKeyError(t('复制公钥'), error) }
  }, [])
  const loadKeyMaterial = useCallback(async (id: string) => {
    try {
      const result = await KeyService.GetMaterial(Number(id))
      if (!result) throw new Error(t('密钥不存在或无法读取'))
      return keyMaterial(result, 0)
    } catch (error) {
      logger.error('loadKeyMaterial failed', error)
      throw error
    }
  }, [])
  const selectKeyImportFile = useCallback(async (): Promise<KeyImportFile | undefined> => {
    try {
      const file = await KeyService.SelectImportFile()
      return file ? { name: file.name, privateKey: file.private_key } : undefined
    } catch (error) { rethrowKeyError(t('读取私钥文件'), error) }
  }, [])
  return { exportKey, loadKeyMaterial, selectKeyImportFile }
}

export function useKeySettingsRuntime() {
  const runtime = useKeyRuntime()
  const collection = useKeyCollection(runtime)
  const commitMutation = useCommitMutation(runtime, collection)
  const createActions = useKeyCreateActions(runtime, commitMutation)
  const manageActions = useKeyManageActions(runtime, commitMutation)
  const readActions = useKeyReadActions()
  return {
    keys: collection.keys, error: collection.error, loading: collection.loading, listKeys: collection.listKeys,
    ...createActions, ...manageActions, ...readActions,
  }
}
