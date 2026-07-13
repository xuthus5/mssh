import { useEffect, useRef, type RefObject } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { Events } from '@wailsio/runtime'
import { useTerminalRuntimeErrorReporter, type TerminalRuntimeErrorReporter } from '@/components/terminal/TerminalErrorBoundary'
import { runTerminalRuntime } from '@/components/terminal/terminalRuntime'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import { applyTerminalTheme, xtermTheme } from '@/lib/terminalTheme'
import { TerminalService } from '@/lib/wails'
import { useAppStore, type AppState } from '@/store/appStore'

const TERMINAL_SCROLLBACK = 10000

interface TerminalOutputEvent {
  terminal_id?: string
  data?: string
}

export interface TerminalFocusRequest {
  sequence: number
  targetTerminalID?: string | null
}

interface UseTerminalOptions {
  active: boolean
  focusRequest: TerminalFocusRequest
}

interface TerminalLifecycleRefs {
  termRef: RefObject<Terminal | null>
  fitAddonRef: RefObject<FitAddon | null>
  activationFrameRef: RefObject<number | null>
  activeRef: RefObject<boolean>
  storeRef: RefObject<AppState>
  recoveryPendingRef: RefObject<boolean>
  requestedSequenceRef: RefObject<number>
  handledSequenceRef: RefObject<number>
  writeFailureReportedRef: RefObject<boolean>
}

function hasVisibleSize(container: HTMLDivElement | null): container is HTMLDivElement {
  return container !== null && container.clientWidth > 0 && container.clientHeight > 0
}

function reportResize(terminalID: string, term: Terminal, context: string) {
  try {
    void TerminalService.Resize(terminalID, term.cols, term.rows).catch((error: unknown) => logger.error(context, error))
  } catch (error: unknown) {
    logger.error(context, error)
  }
}

function fitAndRefresh(term: Terminal, fitAddon: FitAddon, container: HTMLDivElement | null) {
  if (!hasVisibleSize(container)) return false
  fitAddon.fit()
  term.refresh(0, term.rows - 1)
  return true
}

function safelyDispose(label: string, dispose: () => void) {
  try {
    dispose()
  } catch (error: unknown) {
    logger.error(`terminal ${label} cleanup error`, error)
  }
}

function cancelActivationFrame(frameRef: RefObject<number | null>) {
  if (frameRef.current === null) return
  window.cancelAnimationFrame(frameRef.current)
  frameRef.current = null
}

function createTerminal() {
  const theme = useAppStore.getState().terminalTheme
  return new Terminal({
    cursorBlink: true,
    cursorStyle: theme.cursorStyle,
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    theme: xtermTheme(theme),
    scrollback: TERMINAL_SCROLLBACK,
  })
}

function reportWriteFailure(terminalID: string, error: unknown, refs: TerminalLifecycleRefs) {
  refs.storeRef.current.setConnectionStatus(terminalID, 'disconnected')
  if (refs.writeFailureReportedRef.current) return
  refs.writeFailureReportedRef.current = true
  logger.error('terminal write failed', { terminalID, error })
  toast(`终端写入失败: ${error instanceof Error ? error.message : String(error)}`, 'error')
}

function writeTerminalInput(terminalID: string, data: string, refs: TerminalLifecycleRefs) {
  try {
    void TerminalService.Write(terminalID, data).catch((error: unknown) => reportWriteFailure(terminalID, error, refs))
  } catch (error: unknown) {
    reportWriteFailure(terminalID, error, refs)
  }
}

function subscribeToData(term: Terminal, terminalID: string, refs: TerminalLifecycleRefs) {
  return term.onData((data) => {
    refs.storeRef.current.updateLastUsed(terminalID)
    writeTerminalInput(terminalID, data, refs)
  })
}

function subscribeToOutput(term: Terminal, terminalID: string, reportRuntimeError: TerminalRuntimeErrorReporter) {
  return Events.On('terminal:output', (event: { data?: TerminalOutputEvent }) => {
    const payload = event.data
    if (payload?.terminal_id === terminalID && payload.data) {
      runTerminalRuntime(reportRuntimeError, 'terminal output write', () => term.write(payload.data!))
    }
  })
}

function subscribeToTheme(term: Terminal, reportRuntimeError: TerminalRuntimeErrorReporter) {
  return useAppStore.subscribe((state, previous) => {
    if (state.terminalTheme !== previous.terminalTheme) {
      runTerminalRuntime(reportRuntimeError, 'terminal theme update', () => applyTerminalTheme(term.options, state.terminalTheme))
    }
  })
}

function recoverTerminal(terminalID: string, term: Terminal, fitAddon: FitAddon, container: HTMLDivElement | null, refs: TerminalLifecycleRefs) {
  if (!fitAndRefresh(term, fitAddon, container)) return false
  if (refs.requestedSequenceRef.current > refs.handledSequenceRef.current) {
    term.focus()
    refs.storeRef.current.setActivePane(terminalID)
    refs.handledSequenceRef.current = refs.requestedSequenceRef.current
  }
  refs.recoveryPendingRef.current = false
  reportResize(terminalID, term, 'terminal activation resize error')
  return true
}

function observeResize({ term, fitAddon, terminalID, containerRef, refs, reportRuntimeError }: {
  term: Terminal
  fitAddon: FitAddon
  terminalID: string
  containerRef: RefObject<HTMLDivElement | null>
  refs: TerminalLifecycleRefs
  reportRuntimeError: TerminalRuntimeErrorReporter
}) {
  return new ResizeObserver(() => {
    runTerminalRuntime(reportRuntimeError, 'terminal resize', () => {
      if (!refs.activeRef.current) return
      if (refs.recoveryPendingRef.current) {
        recoverTerminal(terminalID, term, fitAddon, containerRef.current, refs)
        return
      }
      if (!fitAndRefresh(term, fitAddon, containerRef.current)) return
      reportResize(terminalID, term, 'terminal resize error')
    })
  })
}

function initializeTerminal(terminalID: string, containerRef: RefObject<HTMLDivElement | null>, refs: TerminalLifecycleRefs, reportRuntimeError: TerminalRuntimeErrorReporter) {
  let disposed = false
  let addonOwnedByTerminal = false
  const container = containerRef.current
  const term = createTerminal()
  const fitAddon = new FitAddon()
  refs.termRef.current = term
  refs.fitAddonRef.current = fitAddon
  if (container) {
    term.open(container)
    term.loadAddon(fitAddon)
    addonOwnedByTerminal = true
    refs.storeRef.current.registerTerminal(terminalID, term)
  }
  const focusHandler = () => runTerminalRuntime(reportRuntimeError, 'terminal pane activation', () => refs.storeRef.current.setActivePane(terminalID))
  container?.addEventListener('focusin', focusHandler)
  container?.addEventListener('pointerdown', focusHandler)
  const dataDispose = subscribeToData(term, terminalID, refs)
  const unsubOutput = subscribeToOutput(term, terminalID, reportRuntimeError)
  const unsubscribeTheme = subscribeToTheme(term, reportRuntimeError)
  const resizeObserver = observeResize({ term, fitAddon, terminalID, containerRef, refs, reportRuntimeError })
  if (container) resizeObserver.observe(container)

  return () => {
    if (disposed) return
    disposed = true
    cancelActivationFrame(refs.activationFrameRef)
    container?.removeEventListener('focusin', focusHandler)
    container?.removeEventListener('pointerdown', focusHandler)
    safelyDispose('data subscription', () => dataDispose.dispose())
    safelyDispose('output subscription', unsubOutput)
    safelyDispose('theme subscription', unsubscribeTheme)
    safelyDispose('resize observer', () => resizeObserver.disconnect())
    if (!addonOwnedByTerminal) safelyDispose('fit addon', () => fitAddon.dispose())
    refs.storeRef.current.unregisterTerminal(terminalID)
    safelyDispose('instance', () => term.dispose())
    refs.fitAddonRef.current = null
    refs.termRef.current = null
  }
}

function useTerminalLifecycle(terminalID: string, containerRef: RefObject<HTMLDivElement | null>, refs: TerminalLifecycleRefs, reportRuntimeError: TerminalRuntimeErrorReporter) {
  useEffect(() => initializeTerminal(terminalID, containerRef, refs, reportRuntimeError), [containerRef, reportRuntimeError, terminalID])
}

function useTerminalActivation({ terminalID, containerRef, refs, active, sequence, reportRuntimeError }: {
  terminalID: string
  containerRef: RefObject<HTMLDivElement | null>
  refs: TerminalLifecycleRefs
  active: boolean
  sequence: number
  reportRuntimeError: TerminalRuntimeErrorReporter
}) {
  useEffect(() => {
    const term = refs.termRef.current
    if (!term) return
    cancelActivationFrame(refs.activationFrameRef)
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
        if (fitAddon) recoverTerminal(terminalID, term, fitAddon, containerRef.current, refs)
      })
    })
    return () => cancelActivationFrame(refs.activationFrameRef)
  }, [active, reportRuntimeError, sequence])
}

export function useTerminal(terminalID: string, containerRef: RefObject<HTMLDivElement | null>, { active, focusRequest }: UseTerminalOptions) {
  const reportRuntimeError = useTerminalRuntimeErrorReporter()
  const refs: TerminalLifecycleRefs = {
    termRef: useRef<Terminal | null>(null),
    fitAddonRef: useRef<FitAddon | null>(null),
    activationFrameRef: useRef<number | null>(null),
    activeRef: useRef(active),
    storeRef: useRef(useAppStore.getState()),
    recoveryPendingRef: useRef(false),
    requestedSequenceRef: useRef(focusRequest.sequence),
    handledSequenceRef: useRef(0),
    writeFailureReportedRef: useRef(false),
  }
  refs.activeRef.current = active
  refs.storeRef.current = useAppStore.getState()
  refs.requestedSequenceRef.current = focusRequest.sequence
  useTerminalLifecycle(terminalID, containerRef, refs, reportRuntimeError)
  useTerminalActivation({ terminalID, containerRef, refs, active, sequence: focusRequest.sequence, reportRuntimeError })
  return refs.termRef
}
