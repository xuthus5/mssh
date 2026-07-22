import type { Terminal } from '@xterm/xterm'
import type { TerminalRuntimeErrorReporter } from '@/components/terminal/TerminalErrorBoundary'
import { runTerminalRuntime } from '@/components/terminal/terminalRuntime'
import { applyTerminalScrollback } from '@/hooks/terminalInstanceRuntime'
import { useTerminalBehaviorStore, type TerminalRenderer } from '@/store/terminalBehaviorStore'

export function subscribeToScrollback(term: Terminal, reportRuntimeError: TerminalRuntimeErrorReporter) {
  return useTerminalBehaviorStore.subscribe((state, previous) => {
    if (state.scrollbackLines === previous.scrollbackLines) return
    runTerminalRuntime(reportRuntimeError, 'terminal scrollback update', () => {
      applyTerminalScrollback(term, state.scrollbackLines)
    })
  })
}

export function subscribeToRenderer(
  applyRenderer: (mode: TerminalRenderer) => void,
  reportRuntimeError: TerminalRuntimeErrorReporter,
) {
  return useTerminalBehaviorStore.subscribe((state, previous) => {
    if (state.renderer === previous.renderer) return
    runTerminalRuntime(reportRuntimeError, 'terminal renderer update', () => {
      applyRenderer(state.renderer)
    })
  })
}
