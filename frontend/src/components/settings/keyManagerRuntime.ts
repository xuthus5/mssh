import { useEffect, useRef, useState } from 'react'
import { toast } from '@/components/ui/toast'
import { getClipboard } from '@/lib/clipboard'
import type { KeyImportFile, KeyInfo, KeyMaterial } from '@/hooks/useSettings'
import type { KeyMaterialMode } from '@/components/settings/KeyDialogs'
import { KeyService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { t } from '@/i18n'

export interface KeyManagerProps {
  keys: KeyInfo[]
  loadError?: string
  loading?: boolean
  onReload?: () => void | Promise<void>
  onGenerate: (name: string, type: KeyInfo['type'], bits: number) => Promise<KeyMaterial | undefined>
  onImport: (name: string, privateKey: string) => Promise<KeyInfo | undefined>
  onDelete: (id: string) => void | Promise<void>
  onExport: (id: string) => Promise<string | undefined>
  onLoadMaterial: (id: string) => Promise<KeyMaterial | undefined>
  onUpdate: (material: KeyMaterial) => Promise<KeyMaterial | undefined>
  onSelectImportFile: () => Promise<KeyImportFile | undefined>
}

export interface MaterialState {
  mode: KeyMaterialMode
  material: KeyMaterial
}

function useKeyManagerState() {
  const [materialState, setMaterialState] = useState<MaterialState | null>(null)
  const [pendingRows, setPendingRows] = useState<ReadonlySet<string>>(() => new Set())
  const [deleteTarget, setDeleteTarget] = useState<{ key: KeyInfo; usage: number } | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [rowActionError, setRowActionError] = useState('')
  const lifecycle = useRef(0)
  const rowActionRequest = useRef(0)
  const materialRequest = useRef(0)
  const deleteGeneration = useRef(0)
  const deleteRequest = useRef(0)
  const activeRows = useRef(new Set<string>())
  const deleteActive = useRef(false)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  return { materialState, setMaterialState, pendingRows, setPendingRows, deleteTarget, setDeleteTarget, deleteError, setDeleteError, deleting, setDeleting, rowActionError, setRowActionError, lifecycle, rowActionRequest, materialRequest, deleteGeneration, deleteRequest, activeRows, deleteActive }
}

type KeyManagerState = ReturnType<typeof useKeyManagerState>

function beginKeyRowAction(state: KeyManagerState, id: string) {
  if (state.activeRows.current.has(id)) return false
  state.activeRows.current.add(id)
  state.setPendingRows((current) => new Set(current).add(id))
  return true
}

function finishKeyRowAction(state: KeyManagerState, id: string, lifecycleToken: number) {
  state.activeRows.current.delete(id)
  if (state.lifecycle.current !== lifecycleToken) return
  state.setPendingRows((current) => {
    const next = new Set(current)
    next.delete(id)
    return next
  })
}

function useOpenMaterial(props: KeyManagerProps, state: KeyManagerState) {
  return async (id: string, mode: KeyMaterialMode) => {
    if (!beginKeyRowAction(state, id)) return
    const lifecycleToken = state.lifecycle.current
    const request = ++state.materialRequest.current
    const rowRequest = ++state.rowActionRequest.current
    const isCurrent = () => state.lifecycle.current === lifecycleToken && state.materialRequest.current === request && state.rowActionRequest.current === rowRequest
    state.setRowActionError('')
    try {
      const material = await props.onLoadMaterial(id)
      if (!isCurrent()) return
      if (material) state.setMaterialState({ mode, material })
      else state.setRowActionError(t('读取密钥失败: ${}', t('密钥不存在或无法读取')))
    } catch (error) {
      if (isCurrent()) state.setRowActionError(t('读取密钥失败: ${}', error instanceof Error ? error.message : String(error)))
    } finally {
      finishKeyRowAction(state, id, lifecycleToken)
    }
  }
}

function useCopyPublicKey(props: KeyManagerProps, state: KeyManagerState) {
  return async (id: string) => {
    if (!beginKeyRowAction(state, id)) return
    const lifecycleToken = state.lifecycle.current
    const request = ++state.rowActionRequest.current
    const isCurrent = () => state.lifecycle.current === lifecycleToken && state.rowActionRequest.current === request
    state.materialRequest.current++
    state.setRowActionError('')
    try {
      const publicKey = await props.onExport(id)
      if (!isCurrent()) return
      if (!publicKey) return state.setRowActionError(t('读取密钥失败: ${}', t('密钥不存在或无法读取')))
      await getClipboard().writeText(publicKey)
      if (isCurrent()) toast(t('公钥已复制'), 'success')
    } catch (error) {
      if (isCurrent()) state.setRowActionError(t('复制公钥失败: ${}', error instanceof Error ? error.message : String(error)))
    } finally {
      finishKeyRowAction(state, id, lifecycleToken)
    }
  }
}

function useDeleteRequest(state: KeyManagerState) {
  return async (key: KeyInfo) => {
    if (!beginKeyRowAction(state, key.id)) return
    const lifecycleToken = state.lifecycle.current
    const request = ++state.rowActionRequest.current
    const isCurrent = () => state.lifecycle.current === lifecycleToken && state.rowActionRequest.current === request
    state.materialRequest.current++
    state.setRowActionError('')
    try {
      const usage = await KeyService.UsageCount(Number(key.id))
      if (!isCurrent()) return
      state.deleteGeneration.current++
      state.deleteRequest.current++
      state.setDeleteError('')
      state.setDeleting(false)
      state.setDeleteTarget({ key, usage })
    } catch (error) {
      if (isCurrent()) state.setRowActionError(t('分析密钥影响失败: ${}', error instanceof Error ? error.message : String(error)))
    } finally {
      finishKeyRowAction(state, key.id, lifecycleToken)
    }
  }
}

function useDeleteConfirmation(props: KeyManagerProps, state: KeyManagerState) {
  const confirmDelete = async () => {
    if (!state.deleteTarget || state.deleteActive.current) return
    state.deleteActive.current = true
    const lifecycleToken = state.lifecycle.current
    const generation = state.deleteGeneration.current
    const request = ++state.deleteRequest.current
    const isCurrent = () => state.lifecycle.current === lifecycleToken && state.deleteGeneration.current === generation && state.deleteRequest.current === request
    const target = state.deleteTarget
    state.setDeleting(true)
    state.setDeleteError('')
    try {
      await props.onDelete(target.key.id)
      if (isCurrent()) state.setDeleteTarget(null)
    } catch (error) {
      logger.error('delete key confirmation failed', error)
      if (isCurrent()) state.setDeleteError(t('删除密钥失败: ${}', error instanceof Error ? error.message : String(error)))
    } finally {
      if (state.deleteRequest.current === request) state.deleteActive.current = false
      if (isCurrent()) state.setDeleting(false)
    }
  }
  const handleOpenChange = (open: boolean) => {
    if (open || state.deleting) return
    state.deleteGeneration.current++
    state.deleteRequest.current++
    state.deleteActive.current = false
    state.setDeleteTarget(null)
    state.setDeleteError('')
  }
  return { confirmDelete, handleOpenChange }
}

export function useKeyManagerRuntime(props: KeyManagerProps) {
  const state = useKeyManagerState()
  const openMaterial = useOpenMaterial(props, state)
  const copyPublicKey = useCopyPublicKey(props, state)
  const requestDelete = useDeleteRequest(state)
  const deletion = useDeleteConfirmation(props, state)
  const dismissTransientState = () => {
    state.materialRequest.current++
    state.rowActionRequest.current++
    state.setMaterialState(null)
    state.setRowActionError('')
    if (state.deleteActive.current) return
    state.deleteGeneration.current++
    state.deleteRequest.current++
    state.setDeleteTarget(null)
    state.setDeleteError('')
    state.setDeleting(false)
  }
  return { ...state, openMaterial, copyPublicKey, requestDelete, dismissTransientState, ...deletion }
}

export type KeyManagerRuntime = ReturnType<typeof useKeyManagerRuntime>
