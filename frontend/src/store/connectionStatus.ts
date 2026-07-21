import type { AppState } from '@/store/appStore'

export type ConnectionStatus = AppState['connectionStatus'][string]

export function canTransitionConnection(current: ConnectionStatus | undefined, next: ConnectionStatus) {
  if (current === next || current === undefined) return true
  const transitions: Record<NonNullable<ConnectionStatus>, Array<ConnectionStatus>> = {
    connecting: ['connected', 'disconnected', 'error', 'closing'],
    connected: ['reconnecting', 'disconnected', 'error', 'closing'],
    reconnecting: ['connected', 'disconnected', 'error', 'closing'],
    closing: ['disconnected', 'error'],
    disconnected: ['connecting', 'reconnecting', 'error'],
    error: ['connecting', 'reconnecting', 'disconnected'],
  }
  return transitions[current].includes(next)
}
