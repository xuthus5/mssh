import { useEffect, useRef, useState } from 'react'
import { Dialogs } from '@wailsio/runtime'
import { toast } from '@/components/ui/toast'
import type { SessionCSVExportRequest } from '@/hooks/useSessionCSVTransfer'
import type { SessionCSVExportResult } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'
import { acquireSessionCSVTransfer } from '@/components/session/sessionCSVTransferGate'

type ExportSessions = (request: SessionCSVExportRequest) => Promise<SessionCSVExportResult>

interface Options {
  open: boolean
  selectedIDs: string[]
  onOpenChange: (open: boolean) => void
  onExport: ExportSessions
}

export function useSessionCSVExportDialog(options: Options) {
  const state = useExportDialogState()
  const runtime = useExportDialogRuntime(options.open, state.setPending)
  const selectedAvailable = options.selectedIDs.length > 0
  const effectiveScope = state.scope === 'selected' && selectedAvailable ? 'selected' : 'all'
  const changeOpen = (open: boolean) => changeExportOpen({ open, state, runtime, onOpenChange: options.onOpenChange })
  const runExport = createRunExport({ options, state, runtime, effectiveScope, changeOpen })
  return { ...state, pending: state.pending, error: state.error, selectedAvailable, effectiveScope, changeOpen, runExport }
}

function useExportDialogState() {
  const [scope, setScope] = useState<'all' | 'selected'>('all')
  const [includePasswords, setIncludePasswords] = useState(false)
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  return { scope, setScope, includePasswords, setIncludePasswords, confirmPassword, setConfirmPassword,
    pending, setPending, error, setError }
}

function useExportDialogRuntime(open: boolean, setPending: (pending: boolean) => void) {
  const lifecycle = useRef(0)
  const requestID = useRef(0)
  const pendingRef = useRef(false)
  const mountedRef = useRef(true)
  useEffect(() => {
    const token = ++lifecycle.current
    mountedRef.current = true
    return () => {
      if (lifecycle.current !== token) return
      mountedRef.current = false
      lifecycle.current++
      requestID.current++
    }
  }, [])
  useEffect(() => {
    if (!open) {
      requestID.current++
      if (!pendingRef.current) setPending(false)
    }
  }, [open, setPending])
  return { lifecycle, requestID, pendingRef, mountedRef }
}

type ExportState = ReturnType<typeof useExportDialogState>
type ExportRuntime = ReturnType<typeof useExportDialogRuntime>

function createRunExport(context: {
  options: Options
  state: ExportState
  runtime: ExportRuntime
  effectiveScope: 'all' | 'selected'
  changeOpen: (open: boolean) => void
}) {
  return async () => {
    const { options, state, runtime } = context
    if (runtime.pendingRef.current) return
    const lease = acquireSessionCSVTransfer('export')
    if (!lease) return
    const request = beginExportRequest(runtime)
    state.setPending(true); state.setError('')
    try {
      const path = await Dialogs.SaveFile(exportFileOptions())
      if (!path || !request.isCurrent()) return
      const result = await options.onExport(buildExportRequest(context, path))
      if (!request.isCurrent()) return
      toast(t('已导出 ${} 个会话', result.count), 'success')
      runtime.pendingRef.current = false
      state.setPending(false)
      context.changeOpen(false)
    } catch (reason) {
      if (request.isCurrent()) state.setError(errorMessage(reason))
    } finally {
      runtime.pendingRef.current = false
      if (runtime.mountedRef.current) state.setPending(false)
      lease.release()
    }
  }
}

function changeExportOpen(context: {
  open: boolean
  state: ExportState
  runtime: ExportRuntime
  onOpenChange: (open: boolean) => void
}) {
  if (context.runtime.pendingRef.current) return
  if (!context.open) {
    context.runtime.requestID.current++
    resetExportState(context.state)
  }
  context.onOpenChange(context.open)
}

function buildExportRequest(context: Parameters<typeof createRunExport>[0], path: string): SessionCSVExportRequest {
  return {
    path: ensureCSVExtension(path),
    sessionIDs: context.effectiveScope === 'selected' ? [...context.options.selectedIDs] : [],
    includePasswords: context.state.includePasswords,
    confirmPassword: context.state.includePasswords ? context.state.confirmPassword : undefined,
  }
}

function beginExportRequest(runtime: ExportRuntime) {
  const lifecycleToken = runtime.lifecycle.current
  const id = ++runtime.requestID.current
  runtime.pendingRef.current = true
  return { id, isCurrent: () => runtime.lifecycle.current === lifecycleToken && runtime.requestID.current === id }
}

function resetExportState(state: ExportState) {
  state.setScope('all'); state.setIncludePasswords(false); state.setConfirmPassword(''); state.setError('')
}

function exportFileOptions() {
  return { Title: t('导出 SSH 会话 CSV'), Filename: sessionCSVFileName(), CanCreateDirectories: true,
    Filters: [{ DisplayName: 'CSV', Pattern: '*.csv' }] }
}

function sessionCSVFileName() { return `mssh-sessions-${new Date().toISOString().slice(0, 10)}.csv` }
function ensureCSVExtension(path: string) { return path.toLowerCase().endsWith('.csv') ? path : `${path}.csv` }
function errorMessage(reason: unknown) { return reason instanceof Error ? reason.message : String(reason) }
