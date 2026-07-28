import { create } from 'zustand'
import { t } from '@/i18n'
import { OperationBusyError } from '@/lib/operationBusyError'

interface TunnelMutationState {
  busySessions: ReadonlySet<string>
}

interface TunnelCatalogChange {
  sessionID: string
  source: symbol
}

const tunnelCatalogChangedEvent = 'mssh:tunnel-catalog-changed'
const activeSessions = new Set<string>()

export const useTunnelMutationState = create<TunnelMutationState>(() => ({ busySessions: new Set() }))

function sessionKey(sessionID: string | number) {
  return String(sessionID)
}

function publishMutationState() {
  useTunnelMutationState.setState({ busySessions: new Set(activeSessions) })
}

export function isTunnelMutationActive(sessionID: string | number) {
  return activeSessions.has(sessionKey(sessionID))
}

export async function runTunnelMutation<T>(sessionID: string | number, operation: () => Promise<T>): Promise<T> {
  const key = sessionKey(sessionID)
  if (activeSessions.has(key)) throw new OperationBusyError(t('隧道操作正在进行'))
  activeSessions.add(key)
  publishMutationState()
  try {
    return await operation()
  } finally {
    activeSessions.delete(key)
    publishMutationState()
  }
}

export function emitTunnelCatalogChanged(sessionID: string | number, source: symbol) {
  const detail: TunnelCatalogChange = { sessionID: sessionKey(sessionID), source }
  window.dispatchEvent(new CustomEvent<TunnelCatalogChange>(tunnelCatalogChangedEvent, { detail }))
}

export function onTunnelCatalogChanged(sessionID: string | number, source: symbol, handler: () => void) {
  const key = sessionKey(sessionID)
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<TunnelCatalogChange>).detail
    if (detail?.sessionID === key && detail.source !== source) handler()
  }
  window.addEventListener(tunnelCatalogChangedEvent, listener)
  return () => window.removeEventListener(tunnelCatalogChangedEvent, listener)
}

export function resetTunnelMutationCoordinator() {
  activeSessions.clear()
  publishMutationState()
}
