import { useEffect, useRef, useState } from 'react'
import { Dialogs } from '@wailsio/runtime'
import type { SessionCSVImportRequest } from '@/hooks/useSessionCSVTransfer'
import {
  buildSessionCSVMapping,
  detectSessionCSVProvider,
  missingSessionCSVFields,
  sessionCSVDefaults,
  type SessionCSVProvider,
  type SessionCSVValues,
} from '@/lib/sessionCSVMapping'
import { toast } from '@/components/ui/toast'
import { SessionCSVConflictPolicy, type SessionCSVImportSummary, type SessionCSVPreview } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'
import { acquireSessionCSVTransfer } from '@/components/session/sessionCSVTransferGate'


export function useSessionCSVImportDialog(
  onPreview: (path: string) => Promise<SessionCSVPreview>,
  onImport: (request: SessionCSVImportRequest) => Promise<SessionCSVImportSummary>,
  onOpenChange: (open: boolean) => void,
) {
  const state = useImportDialogState()
  const runtime = useImportDialogRuntime()
  const requiredMissing = state.preview ? missingSessionCSVFields(state.mapping, state.defaults) : []
  const selectFile = createSelectFile({ state, runtime, onPreview })
  const runImport = createRunImport({ state, runtime, requiredMissing, onImport })
  const applyProvider = (nextProvider: SessionCSVProvider) => applyImportProvider(state, nextProvider)
  const changeOpen = (open: boolean) => changeImportDialogOpen({ open, state, runtime, onOpenChange })
  return {
    policy: state.policy, setPolicy: state.setPolicy, provider: state.provider, path: state.path,
    preview: state.preview, mapping: state.mapping, setMapping: state.setMapping,
    defaults: state.defaults, setDefaults: state.setDefaults, pending: state.pending,
    error: state.error, summary: state.summary, requiredMissing, selectFile, applyProvider, runImport, changeOpen,
  }
}

function useImportDialogState() {
  const [policy, setPolicy] = useState(SessionCSVConflictPolicy.SessionCSVConflictSkip)
  const [provider, setProvider] = useState<SessionCSVProvider>('custom')
  const [path, setPath] = useState('')
  const [preview, setPreview] = useState<SessionCSVPreview | null>(null)
  const [mapping, setMapping] = useState<SessionCSVValues>({})
  const [defaults, setDefaults] = useState<SessionCSVValues>(sessionCSVDefaults())
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState<SessionCSVImportSummary | null>(null)
  return { policy, setPolicy, provider, setProvider, path, setPath, preview, setPreview, mapping, setMapping,
    defaults, setDefaults, pending, setPending, error, setError, summary, setSummary }
}

function useImportDialogRuntime() {
  const lifecycle = useRef(0)
  const requestID = useRef(0)
  const pendingRef = useRef(false)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => {
      if (lifecycle.current === token) {
        lifecycle.current++
        requestID.current++
        pendingRef.current = false
      }
    }
  }, [])
  return { lifecycle, requestID, pendingRef }
}

type ImportState = ReturnType<typeof useImportDialogState>
type ImportRuntime = ReturnType<typeof useImportDialogRuntime>

function createSelectFile(options: {
  state: ImportState
  runtime: ImportRuntime
  onPreview: (path: string) => Promise<SessionCSVPreview>
}) {
  return async () => {
    const { state, runtime, onPreview } = options
    if (runtime.pendingRef.current) return
    const lease = acquireSessionCSVTransfer('import')
    if (!lease) return
    const request = beginImportRequest(runtime)
    state.setPending(true); state.setError(''); state.setSummary(null)
    try {
      const selected = await Dialogs.OpenFile({ Title: t('选择 SSH 会话 CSV'), CanChooseFiles: true, CanChooseDirectories: false, AllowsMultipleSelection: false, Filters: [{ DisplayName: 'CSV', Pattern: '*.csv' }] })
      const selectedPath = typeof selected === 'string' ? selected : Array.isArray(selected) ? selected[0] : ''
      if (!request.isCurrent() || !selectedPath) return
      const nextPreview = await onPreview(selectedPath)
      if (!request.isCurrent()) return
      const nextProvider = detectSessionCSVProvider(nextPreview.headers)
      state.setPath(selectedPath); state.setPreview(nextPreview); state.setProvider(nextProvider)
      state.setMapping(buildSessionCSVMapping(nextProvider, nextPreview.headers)); state.setDefaults(sessionCSVDefaults())
    } catch (reason) {
      if (request.isCurrent()) state.setError(errorMessage(reason))
    } finally {
      finishImportRequest(runtime, request)
      if (request.isCurrent()) state.setPending(false)
      lease.release()
    }
  }
}

function createRunImport(options: {
  state: ImportState
  runtime: ImportRuntime
  requiredMissing: ReturnType<typeof missingSessionCSVFields>
  onImport: (request: SessionCSVImportRequest) => Promise<SessionCSVImportSummary>
}) {
  return async () => {
    const { state, runtime, requiredMissing, onImport } = options
    if (!state.preview || requiredMissing.length > 0 || runtime.pendingRef.current) return
    const lease = acquireSessionCSVTransfer('import')
    if (!lease) return
    const request = beginImportRequest(runtime)
    state.setPending(true); state.setError('')
    try {
      const result = await onImport({ path: state.path, conflictPolicy: state.policy, headerMapping: state.mapping, defaultValues: state.defaults })
      if (!request.isCurrent()) return
      state.setSummary(result)
      toast(t('会话导入完成：新增 ${}，更新 ${}', result.imported, result.updated), result.failed > 0 ? 'info' : 'success')
    } catch (reason) {
      if (request.isCurrent()) state.setError(errorMessage(reason))
    } finally {
      finishImportRequest(runtime, request)
      if (request.isCurrent()) state.setPending(false)
      lease.release()
    }
  }
}

function applyImportProvider(state: ImportState, nextProvider: SessionCSVProvider) {
  if (!state.preview) return
  state.setProvider(nextProvider)
  state.setMapping(buildSessionCSVMapping(nextProvider, state.preview.headers))
}

function changeImportDialogOpen(options: {
  open: boolean
  state: ImportState
  runtime: ImportRuntime
  onOpenChange: (open: boolean) => void
}) {
  if (options.runtime.pendingRef.current) return
  if (!options.open) {
    options.runtime.requestID.current++
    resetImportDialog(options.state)
  }
  options.onOpenChange(options.open)
}

function resetImportDialog(state: ImportState) {
  state.setPolicy(SessionCSVConflictPolicy.SessionCSVConflictSkip); state.setProvider('custom'); state.setPath('')
  state.setPreview(null); state.setMapping({}); state.setDefaults(sessionCSVDefaults())
  state.setSummary(null); state.setError('')
}

function beginImportRequest(runtime: ImportRuntime) {
  const lifecycleToken = runtime.lifecycle.current
  const id = ++runtime.requestID.current
  runtime.pendingRef.current = true
  return { id, isCurrent: () => runtime.lifecycle.current === lifecycleToken && runtime.requestID.current === id }
}

function finishImportRequest(runtime: ImportRuntime, request: ReturnType<typeof beginImportRequest>) {
  if (runtime.requestID.current === request.id) runtime.pendingRef.current = false
}

function errorMessage(reason: unknown) { return reason instanceof Error ? reason.message : String(reason) }
