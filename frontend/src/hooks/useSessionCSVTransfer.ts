import { useCallback } from 'react'
import { SessionService } from '@/lib/wails'
import type { SessionCSVConflictPolicy, SessionCSVExportResult, SessionCSVImportSummary } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'

interface Refreshers {
  refreshFolders: () => Promise<unknown>
  refreshAssets: () => Promise<unknown>
}

export interface SessionCSVExportRequest {
  path: string
  sessionIDs: string[]
  includePasswords: boolean
}

export function useSessionCSVTransfer(refreshers: Refreshers) {
  const exportSessionsCSV = useCallback(async (request: SessionCSVExportRequest): Promise<SessionCSVExportResult> => {
    return SessionService.ExportCSV(request.path, {
      session_ids: request.sessionIDs.map(Number),
      include_passwords: request.includePasswords,
    })
  }, [])

  const importSessionsCSV = useCallback(async (path: string, conflictPolicy: SessionCSVConflictPolicy): Promise<SessionCSVImportSummary> => {
    const summary = await SessionService.ImportCSV(path, { conflict_policy: conflictPolicy })
    await Promise.all([refreshers.refreshFolders(), refreshers.refreshAssets()])
    return summary
  }, [refreshers.refreshAssets, refreshers.refreshFolders])

  return { exportSessionsCSV, importSessionsCSV }
}
