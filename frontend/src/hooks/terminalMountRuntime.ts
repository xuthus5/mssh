import type { RefObject } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import type { TerminalRuntimeErrorReporter } from '@/components/terminal/TerminalErrorBoundary'
import { runTerminalRuntime } from '@/components/terminal/terminalRuntime'
import { logger } from '@/lib/logger'
import { terminalTrace } from '@/lib/terminalTrace'
import { applyTerminalTheme } from '@/lib/terminalTheme'
import { TerminalService } from '@/lib/wails'
import { useAppStore, type AppState } from '@/store/appStore'
import { fitAndRefresh } from '@/hooks/terminalFitRuntime'
import { createTerminalMountSession } from '@/hooks/terminalMountSession'

export const RESIZE_DEBOUNCE_MS = 80

export interface TerminalLifecycleRefs {
  termRef: RefObject<Terminal | null>
  fitAddonRef: RefObject<FitAddon | null>
  activationFrameRef: RefObject<number | null>
  terminalIDRef: RefObject<string>
  registeredTerminalIDRef: RefObject<string>
  activeRef: RefObject<boolean>
  storeRef: RefObject<AppState>
  recoveryPendingRef: RefObject<boolean>
  requestedSequenceRef: RefObject<number>
  handledSequenceRef: RefObject<number>
  writeFailureReportedRef: RefObject<boolean>
  lastResizeRef: RefObject<{ terminalID: string; cols: number; rows: number } | null>
  resizeTimerRef: RefObject<number | null>
  outputFlushRef: RefObject<(() => void) | null>
}

function reportResize(...args: [string, Terminal, string, RefObject<{ terminalID: string; cols: number; rows: number } | null>]) {
  const [terminalID, term, context, lastResizeRef] = args
  if (term.cols < 1 || term.rows < 1) return
  const previous = lastResizeRef.current
  if (previous?.terminalID === terminalID && previous.cols === term.cols && previous.rows === term.rows) return
  lastResizeRef.current = { terminalID, cols: term.cols, rows: term.rows }
  try {
    void TerminalService.Resize(terminalID, term.cols, term.rows).catch((error: unknown) => logger.error(context, error))
  } catch (error: unknown) {
    logger.error(context, error)
  }
}

function cancelActivationFrame(frameRef: RefObject<number | null>) {
  if (frameRef.current === null) return
  window.cancelAnimationFrame(frameRef.current)
  frameRef.current = null
}

function reportWriteFailure(terminalID: string, error: unknown, refs: TerminalLifecycleRefs) {
  refs.storeRef.current.setConnectionStatus(terminalID, 'disconnected')
  if (refs.writeFailureReportedRef.current) return
  refs.writeFailureReportedRef.current = true
  // Pane ConnectionOverlay owns recovery UX; avoid toast + overlay double reporting.
  logger.error('terminal write failed', { terminalID, error })
}

function writeTerminalInput(data: string, refs: TerminalLifecycleRefs) {
  const terminalID = refs.terminalIDRef.current
  terminalTrace('input:write-call', { terminalID, len: data.length })
  const reportFailure = (error: unknown) => {
    if (refs.terminalIDRef.current === terminalID) reportWriteFailure(terminalID, error, refs)
  }
  try {
    void TerminalService.Write(terminalID, data).catch(reportFailure)
  } catch (error: unknown) {
    reportFailure(error)
  }
}

function subscribeToTheme({ term, fitAddon, containerRef, refs, reportRuntimeError, ligaturesController }: {
  term: Terminal
  fitAddon: FitAddon
  containerRef: RefObject<HTMLDivElement | null>
  refs: TerminalLifecycleRefs
  reportRuntimeError: TerminalRuntimeErrorReporter
  ligaturesController: import('@/hooks/terminalInstanceRuntime').TerminalLigaturesController
}) {
  return useAppStore.subscribe((state, previous) => {
    if (state.terminalTheme !== previous.terminalTheme) {
      runTerminalRuntime(reportRuntimeError, 'terminal theme update', () => {
        ligaturesController.apply(state.terminalTheme.ligatures)
        applyTerminalTheme(term.options, state.terminalTheme)
        // Inactive split panes still need a visual refresh after theme changes.
        if (!fitAndRefresh(term, fitAddon, containerRef.current)) {
          if (refs.activeRef.current) refs.recoveryPendingRef.current = true
          return
        }
        refs.recoveryPendingRef.current = false
        reportResize(refs.terminalIDRef.current, term, 'terminal theme resize error', refs.lastResizeRef)
      })
    }
  })
}

export function recoverTerminal({ term, fitAddon, container, refs }: {
  term: Terminal
  fitAddon: FitAddon
  container: HTMLDivElement | null
  refs: TerminalLifecycleRefs
}) {
  if (!fitAndRefresh(term, fitAddon, container)) return false
  if (refs.requestedSequenceRef.current > refs.handledSequenceRef.current) {
    term.focus()
    refs.storeRef.current.setActivePane(refs.terminalIDRef.current)
    refs.handledSequenceRef.current = refs.requestedSequenceRef.current
  }
  refs.recoveryPendingRef.current = false
  reportResize(refs.terminalIDRef.current, term, 'terminal activation resize error', refs.lastResizeRef)
  return true
}

function scheduleBackendResize(term: Terminal, refs: TerminalLifecycleRefs) {
  if (refs.resizeTimerRef.current !== null) window.clearTimeout(refs.resizeTimerRef.current)
  refs.resizeTimerRef.current = window.setTimeout(() => {
    refs.resizeTimerRef.current = null
    reportResize(refs.terminalIDRef.current, term, 'terminal resize error', refs.lastResizeRef)
  }, RESIZE_DEBOUNCE_MS)
}

function observeResize({ term, fitAddon, containerRef, refs, reportRuntimeError }: {
  term: Terminal
  fitAddon: FitAddon
  containerRef: RefObject<HTMLDivElement | null>
  refs: TerminalLifecycleRefs
  reportRuntimeError: TerminalRuntimeErrorReporter
}) {
  return new ResizeObserver(() => {
    runTerminalRuntime(reportRuntimeError, 'terminal resize', () => {
      // Inactive split panes still need fit + PTY resize when layout changes;
      // skipping leaves blank or desynced shells after split/tab switch.
      if (!refs.activeRef.current) {
        if (!fitAndRefresh(term, fitAddon, containerRef.current)) return
        scheduleBackendResize(term, refs)
        return
      }
      if (refs.recoveryPendingRef.current) {
        recoverTerminal({ term, fitAddon, container: containerRef.current, refs })
        return
      }
      if (!fitAndRefresh(term, fitAddon, containerRef.current)) return
      scheduleBackendResize(term, refs)
    })
  })
}

export function initializeTerminal(containerRef: RefObject<HTMLDivElement | null>, refs: TerminalLifecycleRefs, reportRuntimeError: TerminalRuntimeErrorReporter) {
  return createTerminalMountSession({
    containerRef, refs, reportRuntimeError, writeTerminalInput, cancelActivationFrame,
    scheduleBackendResize, subscribeToTheme, observeResize,
  })
}
