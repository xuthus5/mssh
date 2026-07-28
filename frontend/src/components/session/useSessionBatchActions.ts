import { useEffect, useRef, useState } from 'react'
import { MacroService, SessionService } from '@/lib/wails'
import type { BatchSessionResult } from '@/lib/sessionBatch'
import { t } from '@/i18n'

export interface MacroOption { id: number; name: string; command: string }
export type PendingAction = { type: 'connect' } | { type: 'macro'; macro: MacroOption } | { type: 'delete' }
interface BatchTarget { id: number; action: PendingAction; sessionIDs: string[] }

export interface SessionBatchOptions {
  selectedIDs: string[]
  onBatchConnect: (sessionIDs: string[]) => Promise<BatchSessionResult[]>
  onBatchExecuteMacro: (sessionIDs: string[], command: string) => Promise<BatchSessionResult[]>
  onBatchDelete: (sessionIDs: string[]) => Promise<BatchSessionResult[]>
  onComplete: (successfulSessionIDs: string[]) => void
}

export function useSessionBatchActions(options: SessionBatchOptions) {
  const lifecycle = useLifecycleRef()
  const executionActive = useRef(false)
  const macros = useBatchMacros()
  const target = useBatchTarget(options.selectedIDs, executionActive)
  const impact = useBatchDeleteImpact(target.target, target.targetID, lifecycle)
  const execution = useBatchExecution({ options, lifecycle, executionActive, ...target })
  return { ...macros, ...target, ...impact, ...execution }
}

function useBatchMacros() {
  const [macros, setMacros] = useState<MacroOption[]>([])
  const [macroError, setMacroError] = useState('')
  useEffect(() => {
    let current = true
    void MacroService.List().then((items) => {
      if (!current) return
      setMacros(items ?? []); setMacroError('')
    }).catch((error) => {
      if (!current) return
      setMacros([]); setMacroError(error instanceof Error ? error.message : String(error))
    })
    return () => { current = false }
  }, [])
  return { macros, macroError }
}

function useBatchTarget(selectedIDs: string[], executionActive: { current: boolean }) {
  const [target, setTarget] = useState<BatchTarget | null>(null)
  const [executeError, setExecuteError] = useState('')
  const targetID = useRef(0)
  const openAction = (action: PendingAction) => {
    if (executionActive.current || selectedIDs.length === 0) return
    const id = ++targetID.current
    setTarget({ id, action, sessionIDs: [...selectedIDs] }); setExecuteError('')
  }
  const closeAction = () => {
    if (executionActive.current) return
    targetID.current++; setTarget(null); setExecuteError('')
  }
  return { target, setTarget, targetID, executeError, setExecuteError, openAction, closeAction }
}

function useBatchDeleteImpact(target: BatchTarget | null, targetID: { current: number }, lifecycle: { current: number }) {
  const [deleteImpact, setDeleteImpact] = useState<{ tunnels: number; history: number; recordings: number; transfers: number } | null>(null)
  const [impactError, setImpactError] = useState('')
  useEffect(() => {
    if (target?.action.type !== 'delete') {
      setDeleteImpact(null); setImpactError('')
      return
    }
    let current = true
    const lifecycleToken = lifecycle.current
    const currentTarget = target.id
    const isCurrent = () => current && lifecycle.current === lifecycleToken && targetID.current === currentTarget
    void SessionService.SessionsDeleteImpact(target.sessionIDs.map(Number)).then((value) => {
      if (!isCurrent()) return
      setImpactError(''); setDeleteImpact(normalizeDeleteImpact(value))
    }).catch((error) => {
      if (!isCurrent()) return
      setDeleteImpact(null); setImpactError(error instanceof Error ? error.message : String(error))
    })
    return () => { current = false }
  }, [lifecycle, target, targetID])
  return { deleteImpact, impactError }
}

function useBatchExecution(context: SessionBatchExecutionContext) {
  const [results, setResults] = useState<BatchSessionResult[] | null>(null)
  const [executing, setExecuting] = useState(false)
  const executionID = useRef(0)
  const execute = createBatchExecute({ ...context, results, setResults, executing, setExecuting, executionID })
  return { results, setResults, executing, execute }
}

interface SessionBatchExecutionContext {
  options: SessionBatchOptions
  lifecycle: { current: number }
  executionActive: { current: boolean }
  target: BatchTarget | null
  setTarget: (target: BatchTarget | null) => void
  targetID: { current: number }
  setExecuteError: (error: string) => void
}

function createBatchExecute(context: SessionBatchExecutionContext & {
  results: BatchSessionResult[] | null
  setResults: (results: BatchSessionResult[] | null) => void
  executing: boolean
  setExecuting: (executing: boolean) => void
  executionID: { current: number }
}) {
  return async () => {
    if (!context.target || context.executionActive.current) return
    context.executionActive.current = true
    const currentExecution = ++context.executionID.current
    const lifecycleToken = context.lifecycle.current
    const currentTarget = context.target.id
    const actionTarget = context.target
    const isLatest = () => context.lifecycle.current === lifecycleToken && context.executionID.current === currentExecution
    const isCurrent = () => isLatest() && context.targetID.current === currentTarget
    context.setExecuting(true); context.setExecuteError('')
    try {
      const nextResults = await runBatchAction(context.options, actionTarget)
      if (isCurrent()) completeBatchAction(context, nextResults)
    } catch (error) {
      if (isCurrent()) context.setExecuteError(t('批量操作失败: ${}', error instanceof Error ? error.message : String(error)))
    } finally {
      if (context.executionID.current === currentExecution) context.executionActive.current = false
      if (isLatest()) context.setExecuting(false)
    }
  }
}

async function runBatchAction(options: SessionBatchOptions, target: BatchTarget) {
  if (target.action.type === 'connect') return options.onBatchConnect(target.sessionIDs)
  if (target.action.type === 'macro') return options.onBatchExecuteMacro(target.sessionIDs, target.action.macro.command)
  return options.onBatchDelete(target.sessionIDs)
}

function completeBatchAction(context: Parameters<typeof createBatchExecute>[0], results: BatchSessionResult[]) {
  const successfulIDs = results.filter((result) => result.success).map((result) => result.sessionId)
  context.setResults(results); context.targetID.current++; context.setTarget(null); context.options.onComplete(successfulIDs)
}

function normalizeDeleteImpact(value: Awaited<ReturnType<typeof SessionService.SessionsDeleteImpact>>) {
  return value ? { tunnels: value.tunnels, history: value.history, recordings: value.recordings, transfers: value.transfers ?? 0 }
    : { tunnels: 0, history: 0, recordings: 0, transfers: 0 }
}

function useLifecycleRef() {
  const lifecycle = useRef(0)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  return lifecycle
}
