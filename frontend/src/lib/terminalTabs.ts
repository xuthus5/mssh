import type { Tab, TerminalTab } from '@/store/appStore'

export interface TerminalConnectionInfo {
  host: string
  port: number
  username: string
}

interface CreateTerminalTabOptions {
  sessionID: number
  sessionName: string
  terminalID: string
  tabs: Tab[]
  connectionKind?: 'ssh' | 'serial' | 'local'
  connectionInfo?: TerminalConnectionInfo
  serialPortId?: number
}

function nextTerminalInstance(sessionKey: string, tabs: Tab[]): number {
  const used = new Set(
    tabs
      .filter((tab): tab is TerminalTab => {
        if (tab.type !== 'terminal') return false
        const kind = tab.connectionKind ?? 'ssh'
        if (kind === 'local') return sessionKey === 'local'
        if (kind === 'serial') return `serial:${tab.serialPortId ?? 0}` === sessionKey
        return `ssh:${tab.sessionId}` === sessionKey
      })
      .map((tab) => tab.terminalInstance)
      .filter((instance): instance is number => instance !== undefined),
  )
  let instance = 1
  while (used.has(instance)) instance += 1
  return instance
}

export function createTerminalTab({
  sessionID,
  sessionName,
  terminalID,
  tabs,
  connectionKind = 'ssh',
  connectionInfo,
  serialPortId,
}: CreateTerminalTabOptions): TerminalTab {
  const sessionKey = connectionKind === 'local'
    ? 'local'
    : connectionKind === 'serial'
      ? `serial:${serialPortId ?? 0}`
      : `ssh:${sessionID}`
  const terminalInstance = nextTerminalInstance(sessionKey, tabs)
  const tab: TerminalTab = {
    id: `terminal-${terminalID}`,
    title: terminalInstance === 1 ? sessionName : `${sessionName} #${terminalInstance}`,
    type: 'terminal',
    terminalId: terminalID,
    sessionId: sessionID,
    terminalInstance,
    toolPanel: null,
  }
  if (connectionKind === 'serial') {
    tab.connectionKind = 'serial'
    tab.serialPortId = serialPortId
  }
  if (connectionKind === 'local') {
    tab.connectionKind = 'local'
  }
  if (connectionKind === 'ssh' && connectionInfo) {
    tab.connectionHost = connectionInfo.host
    tab.connectionPort = connectionInfo.port
    tab.connectionUsername = connectionInfo.username
  }
  return tab
}

export function terminalConnectionLabel(tab: TerminalTab | undefined): string | undefined {
  const connection = terminalConnectionInfo(tab)
  return connection ? `${connection.username}@${connection.host}:${connection.port}` : undefined
}

export function terminalConnectionInfo(tab: TerminalTab | undefined): TerminalConnectionInfo | undefined {
  if (!tab || (tab.connectionKind ?? 'ssh') !== 'ssh') return undefined
  const { connectionHost: host, connectionPort: port, connectionUsername: username } = tab
  if (!host || !username || typeof port !== 'number' || !Number.isSafeInteger(port) || port <= 0) return undefined
  return { host, port, username }
}
