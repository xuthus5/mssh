import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Tunnel } from '@/hooks/useSession'
import { normalizeTunnelLocalAddress, validateTunnelLocalAddress } from '@/lib/tunnelBind'
import { requestConfirm } from '@/lib/confirmDialog'
import { t } from '@/i18n'
import { useTunnelMutationState } from '@/lib/tunnelMutationCoordinator'

export interface TunnelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tunnels: Tunnel[]
  loadError?: string
  onReload?: () => void | Promise<void>
  onStart: (tunnel: Omit<Tunnel, 'id' | 'running'> & { id?: string }, options?: { silent?: boolean }) => void | Promise<void>
  onStop: (tunnelId: string) => void | Promise<void>
  onDelete?: (tunnelId: string) => void | Promise<void>
  sessionId: string
}

export function useTunnelDialogController(props: TunnelDialogProps) {
  const state = useTunnelDialogState()
  const runtime = useTunnelDialogRuntime(props.open, props.sessionId, state)
  const sharedBusy = useTunnelMutationState((current) => current.busySessions.has(String(props.sessionId)))
  const resetForm = () => resetTunnelForm({ state, runtime, force: false, sharedBusy })
  const handleSubmit = createTunnelSubmit({ props, state, runtime, sharedBusy,
    resetForm: () => resetTunnelForm({ state, runtime, force: true }) })
  const runListAction = createTunnelListAction({ state, runtime, sharedBusy })
  const handleDelete = createTunnelDelete({ props, state, runtime, sharedBusy })
  const handleOpenChange = (open: boolean) => changeTunnelDialogOpen({ open, runtime, state, onOpenChange: props.onOpenChange })
  const localBusy = state.pending || state.actionPending || state.deletePending
  return { ...state, busy: localBusy || sharedBusy, closeBlocked: localBusy,
    resetForm, handleSubmit, runListAction, handleDelete, handleOpenChange }
}

function useTunnelDialogState() {
  const [showAdd, setShowAdd] = useState(false)
  const [type, setType] = useState<string>('local')
  const [localAddress, setLocalAddress] = useState('')
  const [localPort, setLocalPort] = useState('')
  const [remoteAddress, setRemoteAddress] = useState('')
  const [remotePort, setRemotePort] = useState('')
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [pending, setPending] = useState(false)
  const [actionPending, setActionPending] = useState(false)
  const [deletePending, setDeletePending] = useState(false)
  return { showAdd, setShowAdd, type, setType, localAddress, setLocalAddress, localPort, setLocalPort,
    remoteAddress, setRemoteAddress, remotePort, setRemotePort, error, setError,
    actionError, setActionError, pending, setPending, actionPending, setActionPending,
    deletePending, setDeletePending }
}

function useTunnelDialogRuntime(open: boolean, sessionID: string, state: TunnelState) {
  const lifecycle = useLifecycleRef()
  const generation = useRef(0)
  const actionRequestID = useRef(0)
  const submitRequestID = useRef(0)
  const submitActive = useRef(false)
  const listActionActive = useRef(false)
  const deleteRequestID = useRef(0)
  const deleteActive = useRef(false)
  const openRef = useRef(open)
  openRef.current = open
  useEffect(() => {
    generation.current++
    state.setPending(submitActive.current); state.setActionPending(listActionActive.current)
    state.setDeletePending(deleteActive.current); state.setError(''); state.setActionError('')
  }, [open, sessionID])
  return { lifecycle, generation, actionRequestID, submitRequestID, submitActive,
    listActionActive, deleteRequestID, deleteActive, openRef }
}

type TunnelState = ReturnType<typeof useTunnelDialogState>
type TunnelRuntime = ReturnType<typeof useTunnelDialogRuntime>

function createTunnelSubmit(context: {
  props: TunnelDialogProps
  state: TunnelState
  runtime: TunnelRuntime
  sharedBusy: boolean
  resetForm: () => void
}) {
  return async (event: FormEvent) => {
    event.preventDefault()
    const { props, state, runtime } = context
    const bindError = validateTunnelLocalAddress(state.type, state.localAddress)
    if (bindError) {
      state.setError(t(bindError))
      return
    }
    if (tunnelOperationActive(runtime) || context.sharedBusy) return
    const request = beginTunnelSubmit(runtime)
    state.setPending(true); state.setError('')
    try {
      await props.onStart(buildTunnel(props.sessionId, state), { silent: true })
      if (request.isCurrent()) context.resetForm()
    } catch (error) {
      if (request.isCurrent()) state.setError(error instanceof Error ? error.message : String(error))
    } finally {
      if (runtime.submitRequestID.current === request.id) runtime.submitActive.current = false
      if (request.isLatest()) state.setPending(false)
    }
  }
}

function createTunnelListAction(context: { state: TunnelState; runtime: TunnelRuntime; sharedBusy: boolean }) {
  return async (action: () => void | Promise<void>, failure: string) => {
    const { state, runtime } = context
    if (tunnelOperationActive(runtime) || context.sharedBusy) return
    runtime.listActionActive.current = true
    const request = beginTunnelListRequest(runtime)
    state.setActionPending(true); state.setActionError('')
    try {
      await action()
    } catch (error) {
      if (request.isCurrent()) state.setActionError(t(failure, error instanceof Error ? error.message : String(error)))
    } finally {
      if (runtime.actionRequestID.current === request.id) runtime.listActionActive.current = false
      if (request.isLatest()) state.setActionPending(false)
    }
  }
}

function createTunnelDelete(context: {
  props: TunnelDialogProps
  state: TunnelState
  runtime: TunnelRuntime
  sharedBusy: boolean
}) {
  return async (tunnelId: string, label: string) => {
    const { props, runtime, state } = context
    if (!props.onDelete || tunnelOperationActive(runtime) || context.sharedBusy) return
    runtime.deleteActive.current = true
    const request = beginTunnelDelete(runtime)
    state.setDeletePending(true); state.setActionError('')
    try {
      const confirmed = await requestConfirm({ title: t('删除隧道'),
        description: t('确认删除隧道「${}」？此操作不可撤销。', label), confirmLabel: t('删除'),
        cancelLabel: t('取消'), destructive: true })
      if (!confirmed || !request.isCurrent()) return
      await props.onDelete(tunnelId)
    } catch (error) {
      if (request.isCurrent()) state.setActionError(t('删除隧道失败: ${}', error instanceof Error ? error.message : String(error)))
    } finally {
      if (runtime.deleteRequestID.current === request.id) runtime.deleteActive.current = false
      if (request.isLatest()) state.setDeletePending(false)
    }
  }
}

function resetTunnelForm({ state, runtime, force, sharedBusy = false }: {
  state: TunnelState
  runtime: TunnelRuntime
  force: boolean
  sharedBusy?: boolean
}) {
  if (!force && (tunnelOperationActive(runtime) || sharedBusy)) return
  runtime.generation.current++; runtime.submitRequestID.current++; runtime.submitActive.current = false
  state.setPending(false); state.setLocalAddress(''); state.setLocalPort('')
  state.setRemoteAddress(''); state.setRemotePort(''); state.setError(''); state.setShowAdd(false)
}

function changeTunnelDialogOpen(context: {
  open: boolean
  runtime: TunnelRuntime
  state: TunnelState
  onOpenChange: (open: boolean) => void
}) {
  if (!context.open && tunnelOperationActive(context.runtime)) return
  context.runtime.openRef.current = context.open
  if (!context.open) {
    context.runtime.generation.current++; context.runtime.actionRequestID.current++
    context.runtime.submitRequestID.current++; context.runtime.deleteRequestID.current++
    context.runtime.submitActive.current = false; context.runtime.listActionActive.current = false
    context.runtime.deleteActive.current = false; context.state.setPending(false)
    context.state.setActionPending(false); context.state.setDeletePending(false)
  }
  context.onOpenChange(context.open)
}

function buildTunnel(sessionId: string, state: TunnelState) {
  return { sessionId, type: state.type as Tunnel['type'],
    localAddress: normalizeTunnelLocalAddress(state.type, state.localAddress),
    localPort: parseInt(state.localPort, 10) || 0, remoteAddress: state.remoteAddress || '127.0.0.1',
    remotePort: parseInt(state.remotePort, 10) || 0 }
}

function beginTunnelSubmit(runtime: TunnelRuntime) {
  runtime.submitActive.current = true
  return captureTunnelRequest(runtime, runtime.submitRequestID)
}

function beginTunnelListRequest(runtime: TunnelRuntime) {
  return captureTunnelRequest(runtime, runtime.actionRequestID)
}

function beginTunnelDelete(runtime: TunnelRuntime) {
  return captureTunnelRequest(runtime, runtime.deleteRequestID)
}

function captureTunnelRequest(runtime: TunnelRuntime, requestRef: { current: number }) {
  const lifecycleToken = runtime.lifecycle.current
  const generationToken = runtime.generation.current
  const id = ++requestRef.current
  const isLatest = () => runtime.lifecycle.current === lifecycleToken && requestRef.current === id
  return { id, isLatest, isCurrent: () => isLatest()
    && runtime.generation.current === generationToken && runtime.openRef.current }
}

function tunnelOperationActive(runtime: TunnelRuntime) {
  return runtime.submitActive.current || runtime.listActionActive.current || runtime.deleteActive.current
}

function useLifecycleRef() {
  const lifecycle = useRef(0)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  return lifecycle
}
