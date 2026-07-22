import type { Terminal } from '@xterm/xterm'
import type { RefObject } from 'react'
import { recordCommand } from '@/lib/commandHistory'
import { TerminalCommandCapture } from '@/lib/terminalCommandCapture'
import type { AppState } from '@/store/appStore'

export interface TerminalInputRefs {
  terminalIDRef: RefObject<string>
  storeRef: RefObject<AppState>
}

export function resolveSessionId(refs: TerminalInputRefs): number | null {
  const terminalID = refs.terminalIDRef.current
  const tab = refs.storeRef.current.tabs.find((item) => item.type === 'terminal' && item.terminalId === terminalID)
  return tab?.type === 'terminal' ? tab.sessionId : null
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
