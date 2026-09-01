import type { Terminal } from '@xterm/xterm'
import type { RefObject } from 'react'
import { recordCommand } from '@/lib/commandHistory'
import { terminalTrace } from '@/lib/terminalTrace'
import { TerminalCommandCapture } from '@/lib/terminalCommandCapture'
import type { AppState } from '@/store/appStore'

/** Keep interactive input responsive while coalescing rapid key events. */
export const TERMINAL_INPUT_BATCH_DELAY_MS = 8
export const TERMINAL_INPUT_BATCH_MAX_LENGTH = 16 * 1024

const immediateInputPattern = /[\r\n\u0003\u0004\u001a\u001b]/

export interface TerminalInputBatcher {
  write(data: string): void
  flush(): void
  dispose(): void
}

export function createTerminalInputBatcher(
  send: (data: string) => void | Promise<unknown>,
  delayMs = TERMINAL_INPUT_BATCH_DELAY_MS,
): TerminalInputBatcher {
  let pending = ''
  let timer: number | null = null

  const clearTimer = () => {
    if (timer === null) return
    window.clearTimeout(timer)
    timer = null
  }

  const flush = () => {
    clearTimer()
    if (!pending) return
    const data = pending
    pending = ''
    try {
      void Promise.resolve(send(data)).catch(() => undefined)
    } catch {
      // The caller owns reporting transport failures; batching must not throw from xterm's event handler.
    }
  }

  const write = (data: string) => {
    if (!data) return
    pending += data
    if (pending.length >= TERMINAL_INPUT_BATCH_MAX_LENGTH || immediateInputPattern.test(data)) {
      flush()
      return
    }
    if (timer === null) timer = window.setTimeout(flush, delayMs)
  }

  return {
    write,
    flush,
    dispose: () => {
      flush()
      clearTimer()
    },
  }
}

export interface TerminalInputRefs {
  terminalIDRef: RefObject<string>
  storeRef: RefObject<AppState>
}

/** Local-shell history buckets: -(2_000_000 + terminalInstance). Serial uses -serialPortId. */
export const LOCAL_HISTORY_BUCKET_BASE = 2_000_000

export function localHistoryBucket(terminalInstance?: number): number {
  const instance = terminalInstance && terminalInstance > 0 ? terminalInstance : 1
  return -(LOCAL_HISTORY_BUCKET_BASE + instance)
}

/** Resolve history bucket id: SSH sessions use real ids; serial uses negative serialPortId. */
export function resolveSessionId(refs: TerminalInputRefs): number | null {
  const terminalID = refs.terminalIDRef.current
  const tab = refs.storeRef.current.tabs.find((item) => item.type === 'terminal'
    && (item.terminalId === terminalID || item.splitPaneIDs?.includes(terminalID)))
  if (!tab || tab.type !== 'terminal') return null
  if (tab.connectionKind === 'serial') {
    return tab.serialPortId && tab.serialPortId > 0 ? -tab.serialPortId : null
  }
  if (tab.connectionKind === 'local') {
    return localHistoryBucket(tab.terminalInstance)
  }
  return tab.sessionId
}

export function subscribeToTerminalData(...args: [
  Terminal,
  TerminalInputRefs,
  TerminalCommandCapture,
  (data: string) => void,
]) {
  const [term, refs, capture, writeTerminalInput] = args
  return term.onData((data) => {
    const terminalID = refs.terminalIDRef.current
    refs.storeRef.current.updateLastUsed(terminalID)
    terminalTrace('input:keypress', { terminalID, len: data.length })
    writeTerminalInput(data)
    const sessionID = resolveSessionId(refs)
    for (const command of capture.feed(data)) {
      if (sessionID !== null) recordCommand(sessionID, command)
    }
  })
}
