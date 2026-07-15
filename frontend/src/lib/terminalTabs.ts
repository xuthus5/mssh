import type { Tab, TerminalTab } from '@/store/appStore'

interface CreateTerminalTabOptions {
  sessionID: number
  sessionName: string
  terminalID: string
  tabs: Tab[]
}

function nextTerminalInstance(sessionID: number, tabs: Tab[]): number {
  const used = new Set(
    tabs
      .filter((tab): tab is TerminalTab => tab.type === 'terminal' && tab.sessionId === sessionID)
      .map((tab) => tab.terminalInstance)
      .filter((instance): instance is number => instance !== undefined),
  )
  let instance = 1
  while (used.has(instance)) instance += 1
  return instance
}

export function createTerminalTab({ sessionID, sessionName, terminalID, tabs }: CreateTerminalTabOptions): TerminalTab {
  const terminalInstance = nextTerminalInstance(sessionID, tabs)
  return {
    id: `terminal-${terminalID}`,
    title: terminalInstance === 1 ? sessionName : `${sessionName} #${terminalInstance}`,
    type: 'terminal',
    terminalId: terminalID,
    sessionId: sessionID,
    terminalInstance,
  }
}
