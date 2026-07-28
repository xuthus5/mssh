import { useEffect, useRef, useState } from 'react'
import { toast } from '@/components/ui/toast'
import type { AssetEnvironment, AssetProject, AssetTag } from '@/hooks/useSession'
import { t } from '@/i18n'

export type BulkKind = 'environment' | 'project' | 'tags'
export type TagOperation = 'add' | 'remove' | 'replace'

export interface BulkAssetOptions {
  selectedIDs: string[]
  environments: AssetEnvironment[]
  projects: AssetProject[]
  tags: AssetTag[]
  onSetEnvironment: (sessionIDs: string[], targetID: string | null) => Promise<number>
  onSetProject: (sessionIDs: string[], targetID: string | null) => Promise<number>
  onUpdateTags: (sessionIDs: string[], tagIDs: string[], operation: TagOperation) => Promise<number>
  onClearSelection: () => void
}

interface DialogOptions extends BulkAssetOptions {
  kind: BulkKind | null
  onOpenChange: (open: boolean) => void
}

export function useBulkAssetDialog(options: DialogOptions) {
  const state = useBulkDialogState(options.kind, options.selectedIDs.join('\u0000'))
  const submit = createBulkSubmit({ options, state })
  const handleOpenChange = (open: boolean) => changeBulkDialogOpen({ open, state, onOpenChange: options.onOpenChange })
  return { ...state, submit, handleOpenChange }
}

function useBulkDialogState(kind: BulkKind | null, selectionKey: string) {
  const [targetID, setTargetID] = useState('')
  const [tagIDs, setTagIDs] = useState<string[]>([])
  const [operation, setOperation] = useState<TagOperation>('add')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const lifecycle = useRef(0)
  const generation = useRef(0)
  const operationRequest = useRef(0)
  const operationActive = useRef(false)
  useLifecycleToken(lifecycle)
  useEffect(() => {
    generation.current++
    setPending(operationActive.current); setTargetID(''); setTagIDs([]); setOperation('add'); setError('')
  }, [kind, selectionKey])
  return { targetID, setTargetID, tagIDs, setTagIDs, operation, setOperation, pending, setPending,
    error, setError, lifecycle, generation, operationRequest, operationActive }
}

type BulkState = ReturnType<typeof useBulkDialogState>

function createBulkSubmit(context: { options: DialogOptions; state: BulkState }) {
  return async () => {
    const { options, state } = context
    if (!options.kind || state.operationActive.current) return
    const request = beginBulkRequest(state)
    const snapshot = captureBulkSnapshot(options, state)
    state.setPending(true); state.setError('')
    try {
      const count = await runBulkUpdate(options, snapshot)
      if (!request.isCurrent()) return
      toast(t('已更新 ${} 个会话的资产信息', count), 'success')
      options.onClearSelection(); options.onOpenChange(false); resetBulkValues(state)
    } catch (reason) {
      if (request.isCurrent()) state.setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (state.operationRequest.current === request.id) state.operationActive.current = false
      if (request.isLatest()) state.setPending(false)
    }
  }
}

function changeBulkDialogOpen(context: { open: boolean; state: BulkState; onOpenChange: (open: boolean) => void }) {
  if (!context.open && context.state.operationActive.current) return
  if (!context.open) {
    context.state.generation.current++; context.state.operationRequest.current++
    context.state.operationActive.current = false; context.state.setPending(false); context.state.setError('')
  }
  context.onOpenChange(context.open)
}

function beginBulkRequest(state: BulkState) {
  state.operationActive.current = true
  const lifecycleToken = state.lifecycle.current
  const generationToken = state.generation.current
  const id = ++state.operationRequest.current
  const isLatest = () => state.lifecycle.current === lifecycleToken && state.operationRequest.current === id
  return { id, isLatest, isCurrent: () => isLatest() && state.generation.current === generationToken }
}

function captureBulkSnapshot(options: DialogOptions, state: BulkState) {
  return { kind: options.kind, selectedIDs: [...options.selectedIDs], targetID: state.targetID,
    tagIDs: [...state.tagIDs], operation: state.operation }
}

async function runBulkUpdate(options: DialogOptions, snapshot: ReturnType<typeof captureBulkSnapshot>) {
  if (snapshot.kind === 'environment') return options.onSetEnvironment(snapshot.selectedIDs, snapshot.targetID || null)
  if (snapshot.kind === 'project') return options.onSetProject(snapshot.selectedIDs, snapshot.targetID || null)
  return options.onUpdateTags(snapshot.selectedIDs, snapshot.tagIDs, snapshot.operation)
}

function resetBulkValues(state: BulkState) {
  state.setTargetID(''); state.setTagIDs([]); state.setOperation('add')
}

function useLifecycleToken(lifecycle: { current: number }) {
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [lifecycle])
}
