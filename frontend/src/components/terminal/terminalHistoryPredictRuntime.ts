import type { Terminal } from '@xterm/xterm'
import { suggestHistoryCompletion } from '@/lib/commandHistoryPredict'
import { useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'

export interface HistoryPredictHandlers {
  dispose: () => void
}

function isTabKey(event: KeyboardEvent): boolean {
  return event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey
}

/** Complete from session history on Tab when enabled. */
export function installHistoryCommandPredict(
  term: Terminal,
  options: {
    getSessionId: () => number | null | undefined
    getBuffer: () => string
    applyCompletion: (suffix: string) => void
    isEnabled?: () => boolean
  },
): HistoryPredictHandlers {
  const enabled = () => {
    if (options.isEnabled) return options.isEnabled()
    return useTerminalBehaviorStore.getState().historyPredict
  }

  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown' || !isTabKey(event) || !enabled()) return true
    const sessionID = options.getSessionId()
    if (sessionID === null || sessionID === undefined) return true
    const suggestion = suggestHistoryCompletion(options.getBuffer(), sessionID)
    if (!suggestion) return true
    event.preventDefault()
    options.applyCompletion(suggestion)
    return false
  })

  return {
    dispose: () => {
      term.attachCustomKeyEventHandler(() => true)
    },
  }
}

/** Keep a lightweight editable-line buffer in sync with terminal keystrokes. */
export function updateLocalBuffer(buffer: string, data: string): string {
  let next = buffer
  let escape = false
  let tmuxPrefix = false
  for (const character of data) {
    if (escape) {
      if (character === '[' || character === ']' || character === 'O') continue
      if (character >= '@' && character <= '~') escape = false
      continue
    }
    if (tmuxPrefix) {
      tmuxPrefix = false
      continue
    }
    if (character === '\u001b') {
      escape = true
      continue
    }
    if (character === '\u0002') {
      tmuxPrefix = true
      continue
    }
    if (character === '\r' || character === '\n') {
      next = ''
      continue
    }
    if (character === '\u007f' || character === '\b') {
      next = next.slice(0, -1)
      continue
    }
    if (character === '\u0015' || character === '\u0003') {
      next = ''
      continue
    }
    if (character === '\u0017') {
      next = next.trimEnd().replace(/\S+$/, '')
      continue
    }
    if (character >= ' ') next += character
  }
  return next
}
