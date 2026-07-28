import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { toast } from '@/components/ui/toast'
import { useSerial, type SerialPort } from '@/hooks/useSerial'
import { t } from '@/i18n'

export type SerialDeleteTarget =
  | { kind: 'single'; port: SerialPort }
  | { kind: 'batch'; ids: number[]; count: number }
  | null

type SerialActions = Pick<ReturnType<typeof useSerial>, 'refresh' | 'createPort' | 'updatePort' | 'deletePort' | 'deleteMany' | 'duplicatePort' | 'connectPort'>

interface Options extends SerialActions {
  setSelected: Dispatch<SetStateAction<Set<number>>>
}

function useSerialActionRuntime() {
  const [pendingRows, setPendingRows] = useState<ReadonlySet<number>>(() => new Set())
  const lifecycle = useRef(0)
  const connectRequest = useRef(0)
  const duplicateRequest = useRef(0)
  const deleteGeneration = useRef(0)
  const deleteRequest = useRef(0)
  const connectActive = useRef(false)
  const duplicateActive = useRef(false)
  const deleteActive = useRef(false)
  const activeRows = useRef(new Set<number>())
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  return useMemo(() => ({
    lifecycle, connectRequest, duplicateRequest, deleteGeneration, deleteRequest,
    connectActive, duplicateActive, deleteActive, activeRows, pendingRows, setPendingRows,
  }), [pendingRows])
}

type SerialActionRuntime = ReturnType<typeof useSerialActionRuntime>

function acquireRows(runtime: SerialActionRuntime, ids: number[]) {
  if (ids.some((id) => runtime.activeRows.current.has(id))) return false
  ids.forEach((id) => runtime.activeRows.current.add(id))
  runtime.setPendingRows(new Set(runtime.activeRows.current))
  return true
}

function releaseRows(runtime: SerialActionRuntime, ids: number[]) {
  ids.forEach((id) => runtime.activeRows.current.delete(id))
  runtime.setPendingRows(new Set(runtime.activeRows.current))
}

function deleteTargetIDs(target: Exclude<SerialDeleteTarget, null>) {
  return target.kind === 'single' ? [Number(target.port.id)] : target.ids
}

function useSaveSerialPort(options: Options, runtime: SerialActionRuntime) {
  return useCallback(async (input: Parameters<Options['createPort']>[0]) => {
    if (input.id && Number(input.id) > 0) {
      const id = Number(input.id)
      if (!acquireRows(runtime, [id])) throw new Error(t('串口配置正在执行其他操作，请稍后重试'))
      try {
        await options.updatePort(input)
        toast(t('串口配置已更新'), 'success')
      } finally {
        releaseRows(runtime, [id])
      }
      return
    }
    await options.createPort({ ...input, id: 0 })
    toast(t('串口配置已创建'), 'success')
  }, [options.createPort, options.updatePort, runtime])
}

function useConnectAction(options: Options, runtime: SerialActionRuntime, setConnectingID: Dispatch<SetStateAction<number | null>>) {
  return useCallback(async (port: SerialPort) => {
    const id = Number(port.id)
    if (runtime.connectActive.current || !acquireRows(runtime, [id])) return
    runtime.connectActive.current = true
    const lifecycleToken = runtime.lifecycle.current
    const request = ++runtime.connectRequest.current
    const isCurrent = () => runtime.lifecycle.current === lifecycleToken && runtime.connectRequest.current === request
    setConnectingID(id)
    try {
      await options.connectPort(port)
      if (!isCurrent()) return
      toast(t('串口已连接: ${}', port.name || port.device), 'success')
      await options.refresh({ silent: true })
    } catch { /* useSerial owns the connection error banner */ }
    finally {
      if (runtime.connectRequest.current === request) runtime.connectActive.current = false
      releaseRows(runtime, [id])
      if (isCurrent()) setConnectingID(null)
    }
  }, [options.connectPort, options.refresh, runtime, setConnectingID])
}

function useDuplicateAction(context: {
  options: Options
  runtime: SerialActionRuntime
  setDuplicatingID: Dispatch<SetStateAction<number | null>>
  setActionError: Dispatch<SetStateAction<string>>
}) {
  const { options, runtime, setDuplicatingID, setActionError } = context
  return useCallback(async (port: SerialPort) => {
    const id = Number(port.id)
    if (runtime.duplicateActive.current || !acquireRows(runtime, [id])) return
    runtime.duplicateActive.current = true
    const lifecycleToken = runtime.lifecycle.current
    const request = ++runtime.duplicateRequest.current
    const isCurrent = () => runtime.lifecycle.current === lifecycleToken && runtime.duplicateRequest.current === request
    setDuplicatingID(id)
    setActionError('')
    try {
      await options.duplicatePort(port)
      if (isCurrent()) toast(t('串口配置已复制'), 'success')
    } catch (error) {
      if (isCurrent()) setActionError(t('复制串口配置失败: ${}', error instanceof Error ? error.message : String(error)))
    } finally {
      if (runtime.duplicateRequest.current === request) runtime.duplicateActive.current = false
      releaseRows(runtime, [id])
      if (isCurrent()) setDuplicatingID(null)
    }
  }, [options.duplicatePort, runtime, setActionError, setDuplicatingID])
}

function useDeleteTarget(runtime: SerialActionRuntime) {
  const [deleteTarget, setDeleteTarget] = useState<SerialDeleteTarget>(null)
  const [deleteError, setDeleteError] = useState('')
  const openDeleteTarget = useCallback((target: Exclude<SerialDeleteTarget, null>) => {
    if (runtime.deleteActive.current || deleteTargetIDs(target).some((id) => runtime.activeRows.current.has(id))) return
    runtime.deleteGeneration.current++
    runtime.deleteRequest.current++
    setDeleteError('')
    setDeleteTarget(target)
  }, [runtime])
  const closeDeleteTarget = useCallback(() => {
    if (runtime.deleteActive.current) return
    runtime.deleteGeneration.current++
    runtime.deleteRequest.current++
    setDeleteError('')
    setDeleteTarget(null)
  }, [runtime])
  return { deleteTarget, setDeleteTarget, deleteError, setDeleteError, openDeleteTarget, closeDeleteTarget }
}

function useConfirmDelete(options: {
  actions: Options
  runtime: SerialActionRuntime
  target: ReturnType<typeof useDeleteTarget>
  setDeletingID: Dispatch<SetStateAction<number | null>>
  setBatchBusy: Dispatch<SetStateAction<boolean>>
}) {
  return useCallback(async () => {
    const { actions, runtime, target, setDeletingID, setBatchBusy } = options
    const currentTarget = target.deleteTarget
    if (!currentTarget || runtime.deleteActive.current) return
    const ids = deleteTargetIDs(currentTarget)
    if (!acquireRows(runtime, ids)) {
      target.setDeleteError(t('串口配置正在执行其他操作，请稍后重试'))
      return
    }
    runtime.deleteActive.current = true
    const lifecycleToken = runtime.lifecycle.current
    const generation = runtime.deleteGeneration.current
    const request = ++runtime.deleteRequest.current
    const isCurrent = () => runtime.lifecycle.current === lifecycleToken
      && runtime.deleteGeneration.current === generation && runtime.deleteRequest.current === request
    target.setDeleteError('')
    if (currentTarget.kind === 'single') setDeletingID(Number(currentTarget.port.id))
    else setBatchBusy(true)
    try {
      if (currentTarget.kind === 'single') await deleteSingle(currentTarget, actions, isCurrent)
      else await deleteBatch(currentTarget, actions, isCurrent)
      if (isCurrent()) target.setDeleteTarget(null)
    } catch (error) {
      if (isCurrent()) target.setDeleteError(t(currentTarget.kind === 'single' ? '删除串口配置失败: ${}' : '批量删除串口配置失败: ${}', error instanceof Error ? error.message : String(error)))
    } finally {
      if (runtime.deleteRequest.current === request) runtime.deleteActive.current = false
      releaseRows(runtime, ids)
      if (isCurrent()) {
        setDeletingID(null)
        setBatchBusy(false)
      }
    }
  }, [options])
}

export function useSerialPortCenterActions(options: Options) {
  const [connectingID, setConnectingID] = useState<number | null>(null)
  const [duplicatingID, setDuplicatingID] = useState<number | null>(null)
  const [deletingID, setDeletingID] = useState<number | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const runtime = useSerialActionRuntime()
  const target = useDeleteTarget(runtime)
  const save = useSaveSerialPort(options, runtime)
  const connect = useConnectAction(options, runtime, setConnectingID)
  const duplicate = useDuplicateAction({ options, runtime, setDuplicatingID, setActionError })
  const confirmDelete = useConfirmDelete({ actions: options, runtime, target, setDeletingID, setBatchBusy })
  const deletePending = deletingID !== null || batchBusy
  return {
    connectingID, duplicatingID, deletingID, deletePending, pendingRows: runtime.pendingRows, deleteTarget: target.deleteTarget,
    actionError, deleteError: target.deleteError, save, connect, duplicate,
    isRowPending: (id: number) => runtime.activeRows.current.has(id),
    openDeleteTarget: target.openDeleteTarget, closeDeleteTarget: target.closeDeleteTarget, confirmDelete,
  }
}

async function deleteSingle(target: Extract<SerialDeleteTarget, { kind: 'single' }>, options: Options, isCurrent: () => boolean) {
  const id = Number(target.port.id)
  await options.deletePort(id)
  if (!isCurrent()) return
  options.setSelected((current) => { const next = new Set(current); next.delete(id); return next })
  toast(t('串口配置已删除'), 'success')
}

async function deleteBatch(target: Extract<SerialDeleteTarget, { kind: 'batch' }>, options: Options, isCurrent: () => boolean) {
  await options.deleteMany(target.ids)
  if (!isCurrent()) return
  options.setSelected(new Set())
  toast(t('已删除 ${} 个串口配置', String(target.count)), 'success')
}
