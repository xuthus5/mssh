import { AuditService, MacroService, SessionService, TerminalService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { createTerminalTab } from '@/lib/terminalTabs'
import { useAppStore } from '@/store/appStore'
import { openTerminalWithPoolCapacity } from '@/lib/openTerminal'
import { resolveOpenTerminalSize } from '@/lib/terminalOpenSize'

interface BatchSession {
  id: string
  name: string
}

export interface BatchSessionResult {
  sessionId: string
  name: string
  success: boolean
  terminalId?: string
  error?: string
}

async function openSessionTab(session: BatchSession, command?: string): Promise<string> {
  const size = resolveOpenTerminalSize()
  const terminalId = await openTerminalWithPoolCapacity(() => TerminalService.Open(Number(session.id), size.cols, size.rows))
  try {
    if (command) await MacroService.Execute(terminalId, command)
  } catch (error) {
    try { await TerminalService.Close(terminalId) } catch (closeError) { logger.error('close failed batch terminal error', closeError) }
    throw error
  }
  const store = useAppStore.getState()
  const tab = createTerminalTab({ sessionID: Number(session.id), sessionName: session.name, terminalID: terminalId, tabs: store.tabs })
  store.setConnectionStatus(terminalId, 'connected')
  store.openTab(tab)
  return terminalId
}

export async function runBatchSessions(sessions: BatchSession[], command?: string): Promise<BatchSessionResult[]> {
  const results: BatchSessionResult[] = Array.from({ length: sessions.length })
  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < sessions.length) {
      const index = nextIndex++
      const session = sessions[index]
      try {
        const terminalId = await openSessionTab(session, command)
        results[index] = { sessionId: session.id, name: session.name, success: true, terminalId }
      } catch (error) {
        results[index] = { sessionId: session.id, name: session.name, success: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, sessions.length) }, worker))
  try {
    await AuditService.RecordBatch(command ? 'batch_macro' : 'batch_connect', results.map((result) => Number(result.sessionId)), results.map((result) => result.success ? 'success' : 'failed'))
  } catch (error) {
    logger.error('record batch audit failed', error)
  }
  return results
}

export async function runBatchDeleteSessions(sessions: BatchSession[]): Promise<BatchSessionResult[]> {
  if (sessions.length === 0) return []
  const ids = sessions.map((session) => Number(session.id))
  try {
    await SessionService.DeleteSessions(ids)
    const results = sessions.map((session) => ({ sessionId: session.id, name: session.name, success: true }))
    try {
      await AuditService.RecordBatch('batch_delete', ids, results.map(() => 'success'))
    } catch (error) {
      logger.error('record batch delete audit failed', error)
    }
    return results
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const results = sessions.map((session) => ({ sessionId: session.id, name: session.name, success: false, error: message }))
    try {
      await AuditService.RecordBatch('batch_delete', ids, results.map(() => 'failed'))
    } catch (auditError) {
      logger.error('record batch delete audit failed', auditError)
    }
    return results
  }
}
