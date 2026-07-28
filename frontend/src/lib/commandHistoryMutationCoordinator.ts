import { create } from 'zustand'
import { t } from '@/i18n'
import { OperationBusyError } from '@/lib/operationBusyError'

interface CommandHistoryMutationState {
  busySessionIDs: ReadonlySet<number>
}

interface CommandHistoryChange {
  sessionID: number
  source?: symbol
}

const commandHistoryChangedEvent = 'mssh:command-history-changed'
const activeSessionIDs = new Set<number>()

export const useCommandHistoryMutationState = create<CommandHistoryMutationState>(() => ({ busySessionIDs: new Set() }))

function publishMutationState() {
  useCommandHistoryMutationState.setState({ busySessionIDs: new Set(activeSessionIDs) })
}

export function isCommandHistoryMutationActive(sessionID: number) {
  return activeSessionIDs.has(sessionID)
}

export async function runCommandHistoryMutation<T>(sessionID: number, operation: () => Promise<T>): Promise<T> {
  if (activeSessionIDs.has(sessionID)) throw new OperationBusyError(t('命令历史清空操作正在进行'))
  activeSessionIDs.add(sessionID)
  publishMutationState()
  try {
    return await operation()
  } finally {
    activeSessionIDs.delete(sessionID)
    publishMutationState()
  }
}

export function emitCommandHistoryChanged(sessionID: number, source?: symbol) {
  const detail: CommandHistoryChange = { sessionID, source }
  window.dispatchEvent(new CustomEvent<CommandHistoryChange>(commandHistoryChangedEvent, { detail }))
}

export function onCommandHistoryChanged(sessionID: number, source: symbol, handler: () => void) {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<CommandHistoryChange>).detail
    if (detail?.sessionID === sessionID && detail.source !== source) handler()
  }
  window.addEventListener(commandHistoryChangedEvent, listener)
  return () => window.removeEventListener(commandHistoryChangedEvent, listener)
}

export function resetCommandHistoryMutationCoordinator() {
  activeSessionIDs.clear()
  publishMutationState()
}
