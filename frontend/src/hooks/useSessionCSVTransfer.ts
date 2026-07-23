import { logger } from '@/lib/logger'
import { useCallback } from 'react'
import { SessionService } from '@/lib/wails'
import type { SessionCSVConflictPolicy, SessionCSVExportResult, SessionCSVImportSummary, SessionCSVPreview } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'

interface Refreshers {
  refreshFolders: (options?: { silent?: boolean }) => Promise<unknown>
  refreshAssets: (options?: { silent?: boolean }) => Promise<unknown>
}

export interface SessionCSVExportRequest {
  path: string
  sessionIDs: string[]
  includePasswords: boolean
  confirmPassword?: string
}

export interface SessionCSVImportRequest {
  path: string
  conflictPolicy: SessionCSVConflictPolicy
  headerMapping: Record<string, string>
  defaultValues: Record<string, string>
}

export function useSessionCSVTransfer(refreshers: Refreshers) {
  const exportSessionsCSV = useCallback(async (request: SessionCSVExportRequest): Promise<SessionCSVExportResult> => {
    return SessionService.ExportCSV(request.path, {
      session_ids: request.sessionIDs.map(Number),
      include_passwords: request.includePasswords,
      confirm_password: request.includePasswords ? (request.confirmPassword ?? '') : '',
    })
  }, [])

  const previewSessionsCSV = useCallback(async (path: string): Promise<SessionCSVPreview> => {
    return SessionService.PreviewCSV(path)
  }, [])

  const importSessionsCSV = useCallback(async (request: SessionCSVImportRequest): Promise<SessionCSVImportSummary> => {
    const summary = await SessionService.ImportCSV(request.path, {
      conflict_policy: request.conflictPolicy,
      header_mapping: request.headerMapping,
      default_values: request.defaultValues,
    })
    // Import already completed; refresh noise must not rebrand success as import failure.
    void Promise.all([
      refreshers.refreshFolders({ silent: true }).catch((error: unknown) => {
        logger.error('csv import folder refresh failed', error)
      }),
      refreshers.refreshAssets({ silent: true }).catch((error: unknown) => {
        logger.error('csv import asset refresh failed', error)
      }),
    ])
    return summary
  }, [refreshers.refreshAssets, refreshers.refreshFolders])

  return { exportSessionsCSV, previewSessionsCSV, importSessionsCSV }
}
