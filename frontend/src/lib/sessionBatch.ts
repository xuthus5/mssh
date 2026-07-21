import { AuditService, MacroService, TerminalService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { createTerminalTab } from '@/lib/terminalTabs'
import { useAppStore } from '@/store/appStore'
import { openTerminalWithPoolCapacity } from '@/lib/openTerminal'

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
  const terminalId = await openTerminalWithPoolCapacity(() => TerminalService.Open(Number(session.id), 80, 24))
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
