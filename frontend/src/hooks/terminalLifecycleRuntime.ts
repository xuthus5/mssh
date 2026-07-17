import { useEffect, type RefObject } from 'react'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import type { TerminalRuntimeErrorReporter } from '@/components/terminal/TerminalErrorBoundary'
import { runTerminalRuntime } from '@/components/terminal/terminalRuntime'
import { logger } from '@/lib/logger'
import { TerminalService } from '@/lib/wails'

interface ActivationRefs {
  termRef: RefObject<Terminal | null>
  fitAddonRef: RefObject<FitAddon | null>
  activationFrameRef: RefObject<number | null>
  recoveryPendingRef: RefObject<boolean>
}

function cancelFrame(frameRef: RefObject<number | null>) {
  if (frameRef.current === null) return
  window.cancelAnimationFrame(frameRef.current)
  frameRef.current = null
}

export function useTerminalActivation({ refs, active, sequence, reportRuntimeError, recover }: {
  refs: ActivationRefs
  active: boolean
  sequence: number
  reportRuntimeError: TerminalRuntimeErrorReporter
  recover: (term: Terminal, fitAddon: FitAddon) => void
}) {
  useEffect(() => {
    const term = refs.termRef.current
    if (!term) return
    cancelFrame(refs.activationFrameRef)
    if (!active) {
      refs.recoveryPendingRef.current = false
      runTerminalRuntime(reportRuntimeError, 'terminal blur', () => term.blur())
      return
    }
    refs.recoveryPendingRef.current = true
    refs.activationFrameRef.current = window.requestAnimationFrame(() => {
      refs.activationFrameRef.current = null
      runTerminalRuntime(reportRuntimeError, 'terminal activation', () => {
        const fitAddon = refs.fitAddonRef.current
        if (fitAddon) recover(term, fitAddon)
      })
    })
    return () => cancelFrame(refs.activationFrameRef)
  }, [active, reportRuntimeError, sequence])
}

export function useTerminalAttachment(terminalID: string) {
  useEffect(() => {
    try {
      void TerminalService.Attach(terminalID).catch((error: unknown) => logger.error('terminal attach error', error))
    } catch (error: unknown) {
      logger.error('terminal attach error', error)
    }
  }, [terminalID])
}
