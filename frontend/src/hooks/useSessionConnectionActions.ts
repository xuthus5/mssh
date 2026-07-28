import {
  useBatchSessionActions,
  useConnectSession,
  useTerminalConnectionActions,
  type SessionConnectionOptions,
} from '@/hooks/sessionConnectionActionHooks'

export function useSessionConnectionActions(options: SessionConnectionOptions) {
  const connect = useConnectSession(options)
  const batch = useBatchSessionActions(options)
  const terminal = useTerminalConnectionActions(options.sessions)
  return { connect, ...batch, ...terminal }
}
