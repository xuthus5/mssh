import type { Tab, TerminalTab } from '@/store/appStore'

interface CreateTerminalTabOptions {
  sessionID: number
  sessionName: string
  terminalID: string
  tabs: Tab[]
  connectionKind?: 'ssh' | 'serial'
  serialPortId?: number
}

function nextTerminalInstance(sessionKey: string, tabs: Tab[]): number {
  const used = new Set(
    tabs
      .filter((tab): tab is TerminalTab => {
        if (tab.type !== 'terminal') return false
        const kind = tab.connectionKind ?? 'ssh'
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
  serialPortId,
}: CreateTerminalTabOptions): TerminalTab {
  const sessionKey = connectionKind === 'serial' ? `serial:${serialPortId ?? 0}` : `ssh:${sessionID}`
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
  return tab
}
