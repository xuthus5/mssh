import { useEffect, type RefObject } from 'react'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import type { TerminalRuntimeErrorReporter } from '@/components/terminal/TerminalErrorBoundary'
import { runTerminalRuntime } from '@/components/terminal/terminalRuntime'
import { logger } from '@/lib/logger'
import { replaceTerminalSearch } from '@/lib/terminalSearchRegistry'
import { TerminalService } from '@/lib/wails'

const MAX_ACTIVATION_FRAMES = 30

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
  recover: (term: Terminal, fitAddon: FitAddon) => boolean
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
    let cancelled = false
    let attempts = 0
    const scheduleRecovery = () => {
      if (cancelled || refs.activationFrameRef.current !== null) return
      refs.activationFrameRef.current = window.requestAnimationFrame(recoverOnFrame)
    }
    const recoverOnFrame = () => {
      refs.activationFrameRef.current = null
      attempts += 1
      let recovered = false
      const succeeded = runTerminalRuntime(reportRuntimeError, 'terminal activation', () => {
        const fitAddon = refs.fitAddonRef.current
        if (fitAddon) recovered = recover(term, fitAddon)
      })
      if (cancelled || !succeeded || recovered || attempts >= MAX_ACTIVATION_FRAMES) return
      scheduleRecovery()
    }
    scheduleRecovery()
    const fontsReady = document.fonts?.ready
    if (fontsReady) {
      void fontsReady.then(scheduleRecovery, (error: unknown) => logger.error('terminal font readiness error', error))
    }
    return () => {
      cancelled = true
      cancelFrame(refs.activationFrameRef)
    }
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

export function useTerminalIdentity(terminalID: string, registeredTerminalIDRef: RefObject<string>) {
  useEffect(() => {
    const previousID = registeredTerminalIDRef.current
    if (previousID === terminalID) return
    replaceTerminalSearch(previousID, terminalID)
    registeredTerminalIDRef.current = terminalID
  }, [registeredTerminalIDRef, terminalID])
}
