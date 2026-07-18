import { useEffect, useRef, type RefObject } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import type { Terminal } from '@xterm/xterm'
import { useTerminalRuntimeErrorReporter, type TerminalRuntimeErrorReporter } from '@/components/terminal/TerminalErrorBoundary'
import { installTerminalCopyOnSelect } from '@/components/terminal/terminalBehaviorRuntime'
import { runTerminalRuntime } from '@/components/terminal/terminalRuntime'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import { applyTerminalTheme } from '@/lib/terminalTheme'
import { TerminalService } from '@/lib/wails'
import { useAppStore, type AppState } from '@/store/appStore'
import { recordCommand } from '@/lib/commandHistory'
import { TerminalCommandCapture } from '@/lib/terminalCommandCapture'
import { registerTerminalSearch, unregisterTerminalSearch } from '@/lib/terminalSearchRegistry'
import { useTerminalActivation, useTerminalAttachment, useTerminalIdentity } from '@/hooks/terminalLifecycleRuntime'
import { fitAndRefresh } from '@/hooks/terminalFitRuntime'
import { createTerminalInstance, loadCanvasRenderer, safelyDisposeTerminalResource } from '@/hooks/terminalInstanceRuntime'
import { subscribeToSynchronizedOutputQuery, subscribeToTerminalOutput, subscribeToTerminalVersionQuery } from '@/hooks/terminalOutputRuntime'

const RESIZE_DEBOUNCE_MS = 80

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
}

function reportResize(terminalID: string, term: Terminal, context: string, lastResizeRef: RefObject<{ terminalID: string; cols: number; rows: number } | null>) {
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
  logger.error('terminal write failed', { terminalID, error })
  toast(`终端写入失败: ${error instanceof Error ? error.message : String(error)}`, 'error')
}

function writeTerminalInput(data: string, refs: TerminalLifecycleRefs) {
  const terminalID = refs.terminalIDRef.current
  const reportFailure = (error: unknown) => {
    if (refs.terminalIDRef.current === terminalID) reportWriteFailure(terminalID, error, refs)
  }
  try {
    void TerminalService.Write(terminalID, data).catch(reportFailure)
  } catch (error: unknown) {
    reportFailure(error)
  }
}

function subscribeToData(term: Terminal, refs: TerminalLifecycleRefs) {
  const capture = new TerminalCommandCapture()
  return term.onData((data) => {
    const terminalID = refs.terminalIDRef.current
    refs.storeRef.current.updateLastUsed(terminalID)
    writeTerminalInput(data, refs)
    const tab = refs.storeRef.current.tabs.find((item) => item.type === 'terminal' && item.terminalId === terminalID)
    if (tab?.type === 'terminal') {
      for (const command of capture.feed(data)) recordCommand(tab.sessionId, command)
    }
  })
}

function subscribeToTheme({ term, fitAddon, containerRef, refs, reportRuntimeError }: {
  term: Terminal
  fitAddon: FitAddon
  containerRef: RefObject<HTMLDivElement | null>
  refs: TerminalLifecycleRefs
  reportRuntimeError: TerminalRuntimeErrorReporter
}) {
  return useAppStore.subscribe((state, previous) => {
    if (state.terminalTheme !== previous.terminalTheme) {
      runTerminalRuntime(reportRuntimeError, 'terminal theme update', () => {
        applyTerminalTheme(term.options, state.terminalTheme)
        if (!refs.activeRef.current || !fitAndRefresh(term, fitAddon, containerRef.current)) {
          refs.recoveryPendingRef.current = true
          return
        }
        refs.recoveryPendingRef.current = false
        reportResize(refs.terminalIDRef.current, term, 'terminal theme resize error', refs.lastResizeRef)
      })
    }
  })
}

function recoverTerminal({ term, fitAddon, container, refs }: {
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

function observeResize({ term, fitAddon, containerRef, refs, reportRuntimeError }: {
  term: Terminal
  fitAddon: FitAddon
  containerRef: RefObject<HTMLDivElement | null>
  refs: TerminalLifecycleRefs
  reportRuntimeError: TerminalRuntimeErrorReporter
}) {
  return new ResizeObserver(() => {
    runTerminalRuntime(reportRuntimeError, 'terminal resize', () => {
      if (!refs.activeRef.current) return
      if (refs.recoveryPendingRef.current) {
        recoverTerminal({ term, fitAddon, container: containerRef.current, refs })
        return
      }
      if (!fitAndRefresh(term, fitAddon, containerRef.current)) return
      if (refs.resizeTimerRef.current !== null) window.clearTimeout(refs.resizeTimerRef.current)
      refs.resizeTimerRef.current = window.setTimeout(() => {
        refs.resizeTimerRef.current = null
        reportResize(refs.terminalIDRef.current, term, 'terminal resize error', refs.lastResizeRef)
      }, RESIZE_DEBOUNCE_MS)
    })
  })
}

function initializeTerminal(containerRef: RefObject<HTMLDivElement | null>, refs: TerminalLifecycleRefs, reportRuntimeError: TerminalRuntimeErrorReporter) {
  let disposed = false
  let addonOwnedByTerminal = false
  let unicodeAddonOwnedByTerminal = false
  let searchAddonOwnedByTerminal = false
  let cleanupCopyOnSelect: (() => void) | undefined
  const container = containerRef.current
  const term = createTerminalInstance()
  const fitAddon = new FitAddon()
  const unicodeAddon = new Unicode11Addon()
  const searchAddon = new SearchAddon({ highlightLimit: 1000 })
  const initialTerminalID = refs.terminalIDRef.current
  refs.termRef.current = term
  refs.fitAddonRef.current = fitAddon
  if (container) {
    term.open(container)
    loadCanvasRenderer(term)
    term.loadAddon(unicodeAddon)
    unicodeAddonOwnedByTerminal = true
    if (term.unicode) term.unicode.activeVersion = '11'
    term.loadAddon(searchAddon)
    searchAddonOwnedByTerminal = true
    registerTerminalSearch(initialTerminalID, searchAddon)
    cleanupCopyOnSelect = installTerminalCopyOnSelect(term, 'terminal')
    term.loadAddon(fitAddon)
    addonOwnedByTerminal = true
    refs.storeRef.current.registerTerminal(initialTerminalID, term)
  }
  const focusHandler = () => runTerminalRuntime(reportRuntimeError, 'terminal pane activation', () => refs.storeRef.current.setActivePane(refs.terminalIDRef.current))
  container?.addEventListener('focusin', focusHandler)
  container?.addEventListener('pointerdown', focusHandler)
  const dataDispose = subscribeToData(term, refs)
  const synchronizedOutputQueryDispose = subscribeToSynchronizedOutputQuery(term)
  const terminalVersionQueryDispose = subscribeToTerminalVersionQuery(term)
  const unsubOutput = subscribeToTerminalOutput({ term, terminalIDRef: refs.terminalIDRef, reportRuntimeError })
  const unsubscribeTheme = subscribeToTheme({ term, fitAddon, containerRef, refs, reportRuntimeError })
  const resizeObserver = observeResize({ term, fitAddon, containerRef, refs, reportRuntimeError })
  if (container) resizeObserver.observe(container)

  return () => {
    if (disposed) return
    disposed = true
    cancelActivationFrame(refs.activationFrameRef)
    if (refs.resizeTimerRef.current !== null) window.clearTimeout(refs.resizeTimerRef.current)
    container?.removeEventListener('focusin', focusHandler)
    container?.removeEventListener('pointerdown', focusHandler)
    safelyDisposeTerminalResource('data subscription', () => dataDispose.dispose())
    safelyDisposeTerminalResource('synchronized output query', () => synchronizedOutputQueryDispose.dispose())
    safelyDisposeTerminalResource('terminal version query', () => terminalVersionQueryDispose.dispose())
    safelyDisposeTerminalResource('output subscription', unsubOutput)
    safelyDisposeTerminalResource('theme subscription', unsubscribeTheme)
    safelyDisposeTerminalResource('resize observer', () => resizeObserver.disconnect())
    if (cleanupCopyOnSelect) safelyDisposeTerminalResource('copy-on-select subscription', cleanupCopyOnSelect)
    unregisterTerminalSearch(refs.registeredTerminalIDRef.current)
    if (!addonOwnedByTerminal) safelyDisposeTerminalResource('fit addon', () => fitAddon.dispose())
    if (!unicodeAddonOwnedByTerminal) safelyDisposeTerminalResource('unicode addon', () => unicodeAddon.dispose())
    if (!searchAddonOwnedByTerminal) safelyDisposeTerminalResource('search addon', () => searchAddon.dispose())
    refs.storeRef.current.unregisterTerminal(refs.terminalIDRef.current)
    safelyDisposeTerminalResource('instance', () => term.dispose())
    refs.fitAddonRef.current = null
    refs.termRef.current = null
  }
}

function useTerminalLifecycle(containerRef: RefObject<HTMLDivElement | null>, refs: TerminalLifecycleRefs, reportRuntimeError: TerminalRuntimeErrorReporter) {
  useEffect(() => initializeTerminal(containerRef, refs, reportRuntimeError), [containerRef, reportRuntimeError])
}

export function useTerminal(terminalID: string, containerRef: RefObject<HTMLDivElement | null>, { active, focusRequest }: UseTerminalOptions) {
  const reportRuntimeError = useTerminalRuntimeErrorReporter()
  const refs: TerminalLifecycleRefs = {
    termRef: useRef<Terminal | null>(null),
    fitAddonRef: useRef<FitAddon | null>(null),
    activationFrameRef: useRef<number | null>(null),
    terminalIDRef: useRef(terminalID),
    registeredTerminalIDRef: useRef(terminalID),
    activeRef: useRef(active),
    storeRef: useRef(useAppStore.getState()),
    recoveryPendingRef: useRef(false),
    requestedSequenceRef: useRef(focusRequest.sequence),
    handledSequenceRef: useRef(0),
    writeFailureReportedRef: useRef(false),
    lastResizeRef: useRef<{ terminalID: string; cols: number; rows: number } | null>(null),
    resizeTimerRef: useRef<number | null>(null),
  }
  if (refs.terminalIDRef.current !== terminalID) {
    refs.terminalIDRef.current = terminalID
    refs.writeFailureReportedRef.current = false
  }
  refs.activeRef.current = active
  refs.storeRef.current = useAppStore.getState()
  refs.requestedSequenceRef.current = focusRequest.sequence
  useTerminalLifecycle(containerRef, refs, reportRuntimeError)
  useTerminalIdentity(terminalID, refs.registeredTerminalIDRef)
  useTerminalAttachment(terminalID)
  useTerminalActivation({ refs, active, sequence: focusRequest.sequence, reportRuntimeError,
    recover: (term, fitAddon) => recoverTerminal({ term, fitAddon, container: containerRef.current, refs }) })
  return refs.termRef
}
