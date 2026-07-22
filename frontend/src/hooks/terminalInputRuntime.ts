import type { Terminal } from '@xterm/xterm'
import type { RefObject } from 'react'
import { recordCommand } from '@/lib/commandHistory'
import { TerminalCommandCapture } from '@/lib/terminalCommandCapture'
import type { AppState } from '@/store/appStore'

export interface TerminalInputRefs {
  terminalIDRef: RefObject<string>
  storeRef: RefObject<AppState>
}

/** Resolve history bucket id: SSH sessions use real ids; serial uses negative serialPortId. */
export function resolveSessionId(refs: TerminalInputRefs): number | null {
  const terminalID = refs.terminalIDRef.current
  const tab = refs.storeRef.current.tabs.find((item) => item.type === 'terminal' && item.terminalId === terminalID)
  if (!tab || tab.type !== 'terminal') return null
  if (tab.connectionKind === 'serial') {
    return tab.serialPortId && tab.serialPortId > 0 ? -tab.serialPortId : null
  }
  return tab.sessionId
}

export function subscribeToTerminalData(
  term: Terminal,
  refs: TerminalInputRefs,
  capture: TerminalCommandCapture,
  writeTerminalInput: (data: string) => void,
) {
  return term.onData((data) => {
    const terminalID = refs.terminalIDRef.current
    refs.storeRef.current.updateLastUsed(terminalID)
    writeTerminalInput(data)
    const sessionID = resolveSessionId(refs)
    for (const command of capture.feed(data)) {
      if (sessionID !== null) recordCommand(sessionID, command)
    }
  })
}
