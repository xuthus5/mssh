import { useState } from 'react'
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


export function useSessionCSVImportDialog(
  onPreview: (path: string) => Promise<SessionCSVPreview>,
  onImport: (request: SessionCSVImportRequest) => Promise<SessionCSVImportSummary>,
  onOpenChange: (open: boolean) => void,
) {
  const [policy, setPolicy] = useState(SessionCSVConflictPolicy.SessionCSVConflictSkip)
  const [provider, setProvider] = useState<SessionCSVProvider>('custom')
  const [path, setPath] = useState('')
  const [preview, setPreview] = useState<SessionCSVPreview | null>(null)
  const [mapping, setMapping] = useState<SessionCSVValues>({})
  const [defaults, setDefaults] = useState<SessionCSVValues>(sessionCSVDefaults())
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState<SessionCSVImportSummary | null>(null)
  const requiredMissing = preview ? missingSessionCSVFields(mapping, defaults) : []
  const selectFile = async () => {
    setPending(true); setError(''); setSummary(null)
    try {
      const selected = await Dialogs.OpenFile({ Title: t('选择 SSH 会话 CSV'), CanChooseFiles: true, CanChooseDirectories: false, AllowsMultipleSelection: false, Filters: [{ DisplayName: 'CSV', Pattern: '*.csv' }] })
      const selectedPath = typeof selected === 'string' ? selected : Array.isArray(selected) ? selected[0] : ''
      if (!selectedPath) return
      const nextPreview = await onPreview(selectedPath)
      const nextProvider = detectSessionCSVProvider(nextPreview.headers)
      setPath(selectedPath); setPreview(nextPreview); setProvider(nextProvider)
      setMapping(buildSessionCSVMapping(nextProvider, nextPreview.headers)); setDefaults(sessionCSVDefaults())
    } catch (reason) { setError(errorMessage(reason)) } finally { setPending(false) }
  }
  const applyProvider = (nextProvider: SessionCSVProvider) => {
    if (!preview) return
    setProvider(nextProvider); setMapping(buildSessionCSVMapping(nextProvider, preview.headers))
  }
  const runImport = async () => {
    if (!preview || requiredMissing.length > 0) return
    setPending(true); setError('')
    try {
      const result = await onImport({ path, conflictPolicy: policy, headerMapping: mapping, defaultValues: defaults })
      setSummary(result); toast(t('会话导入完成：新增 ${}，更新 ${}', result.imported, result.updated), result.failed > 0 ? 'info' : 'success')
    } catch (reason) { setError(errorMessage(reason)) } finally { setPending(false) }
  }
  const reset = () => {
    setPolicy(SessionCSVConflictPolicy.SessionCSVConflictSkip); setProvider('custom'); setPath(''); setPreview(null)
    setMapping({}); setDefaults(sessionCSVDefaults()); setSummary(null); setError('')
  }
  const changeOpen = (open: boolean) => {
    if (pending) return
    if (!open) reset()
    onOpenChange(open)
  }
  return { policy, setPolicy, provider, path, preview, mapping, setMapping, defaults, setDefaults, pending, error, summary, requiredMissing, selectFile, applyProvider, runImport, changeOpen }
}

function errorMessage(reason: unknown) { return reason instanceof Error ? reason.message : String(reason) }
