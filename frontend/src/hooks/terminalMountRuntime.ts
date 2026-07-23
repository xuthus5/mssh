import type { RefObject } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import type { Terminal } from '@xterm/xterm'
import type { TerminalRuntimeErrorReporter } from '@/components/terminal/TerminalErrorBoundary'
import { installTerminalCopyOnSelect } from '@/components/terminal/terminalBehaviorRuntime'
import { installHistoryCommandPredict } from '@/components/terminal/terminalHistoryPredictRuntime'
import { resolveSessionId, subscribeToTerminalData } from '@/hooks/terminalInputRuntime'
import { subscribeToRenderer, subscribeToScrollback } from '@/hooks/terminalBehaviorSubscriptions'
import { runTerminalRuntime } from '@/components/terminal/terminalRuntime'
import { logger } from '@/lib/logger'
import { applyTerminalTheme } from '@/lib/terminalTheme'
import { TerminalService } from '@/lib/wails'
import { useAppStore, type AppState } from '@/store/appStore'
import { useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'
import { TerminalCommandCapture } from '@/lib/terminalCommandCapture'
import { registerTerminalSearch, unregisterTerminalSearch } from '@/lib/terminalSearchRegistry'
import { fitAndRefresh } from '@/hooks/terminalFitRuntime'
import { createTerminalInstance, createTerminalRendererController, safelyDisposeTerminalResource } from '@/hooks/terminalInstanceRuntime'
import { subscribeToSynchronizedOutputQuery, subscribeToTerminalOutput, subscribeToTerminalVersionQuery } from '@/hooks/terminalOutputRuntime'
import { subscribeToTerminalWorkingDirectory } from '@/hooks/terminalDirectoryRuntime'

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
  // Pane ConnectionOverlay owns recovery UX; avoid toast + overlay double reporting.
  logger.error('terminal write failed', { terminalID, error })
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
  const rendererController = createTerminalRendererController(term)
  if (container) {
    term.open(container)
    rendererController.apply(useTerminalBehaviorStore.getState().renderer)
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
  const commandCapture = new TerminalCommandCapture()
  const historyPredict = installHistoryCommandPredict(term, {
    getSessionId: () => resolveSessionId(refs),
    getBuffer: () => commandCapture.current(),
    applyCompletion: (suffix) => {
      writeTerminalInput(suffix, refs)
      commandCapture.feed(suffix)
    },
  })
  const focusHandler = () => runTerminalRuntime(reportRuntimeError, 'terminal pane activation', () => refs.storeRef.current.setActivePane(refs.terminalIDRef.current))
  container?.addEventListener('focusin', focusHandler)
  container?.addEventListener('pointerdown', focusHandler)
  const dataDispose = subscribeToTerminalData(term, refs, commandCapture, (data) => writeTerminalInput(data, refs))
  const synchronizedOutputQueryDispose = subscribeToSynchronizedOutputQuery(term)
  const terminalVersionQueryDispose = subscribeToTerminalVersionQuery(term)
  const terminalDirectoryDispose = subscribeToTerminalWorkingDirectory(term, refs.terminalIDRef)
  const outputSubscription = subscribeToTerminalOutput({
    term,
    terminalIDRef: refs.terminalIDRef,
    reportRuntimeError,
    shouldCoalesce: () => !refs.activeRef.current,
  })
  refs.outputFlushRef.current = () => outputSubscription.flush()
  const unsubscribeTheme = subscribeToTheme({ term, fitAddon, containerRef, refs, reportRuntimeError })
  const unsubscribeScrollback = subscribeToScrollback(term, reportRuntimeError)
  const unsubscribeRenderer = subscribeToRenderer((mode) => {
    rendererController.apply(mode)
  }, reportRuntimeError)
  const resizeObserver = observeResize({ term, fitAddon, containerRef, refs, reportRuntimeError })
  if (container) resizeObserver.observe(container)
  const onHostMoved = (event: Event) => {
    const detail = (event as CustomEvent<{ terminalID?: string }>).detail
    if (!detail?.terminalID || detail.terminalID !== refs.terminalIDRef.current) return
    // Reparent can leave both active and inactive panes at zero size or with a lost GL context.
    // Retry across frames even when the pane is not focused (common after split on the old shell).
    cancelActivationFrame(refs.activationFrameRef)
    refs.recoveryPendingRef.current = true
    let attempts = 0
    const recoverMovedHost = () => {
      refs.activationFrameRef.current = null
      attempts += 1
      let recovered = false
      const succeeded = runTerminalRuntime(reportRuntimeError, 'terminal host reparent', () => {
        rendererController.apply(useTerminalBehaviorStore.getState().renderer)
        if (!fitAndRefresh(term, fitAddon, containerRef.current)) return
        recovered = true
        refs.recoveryPendingRef.current = false
        scheduleBackendResize(term, refs)
      })
      if (!succeeded || recovered || attempts >= 30 || disposed) return
      refs.activationFrameRef.current = window.requestAnimationFrame(recoverMovedHost)
    }
    refs.activationFrameRef.current = window.requestAnimationFrame(recoverMovedHost)
  }
  window.addEventListener('mssh:terminal-host-moved', onHostMoved)

  return () => {
    if (disposed) return
    disposed = true
    refs.outputFlushRef.current = null
    cancelActivationFrame(refs.activationFrameRef)
    if (refs.resizeTimerRef.current !== null) window.clearTimeout(refs.resizeTimerRef.current)
    container?.removeEventListener('focusin', focusHandler)
    container?.removeEventListener('pointerdown', focusHandler)
    safelyDisposeTerminalResource('history predict', historyPredict.dispose)
    safelyDisposeTerminalResource('data subscription', () => dataDispose.dispose())
    safelyDisposeTerminalResource('synchronized output query', () => synchronizedOutputQueryDispose.dispose())
    safelyDisposeTerminalResource('terminal version query', () => terminalVersionQueryDispose.dispose())
    safelyDisposeTerminalResource('terminal working directory', () => terminalDirectoryDispose.dispose())
    safelyDisposeTerminalResource('output subscription', outputSubscription.dispose)
    safelyDisposeTerminalResource('theme subscription', unsubscribeTheme)
    safelyDisposeTerminalResource('scrollback subscription', unsubscribeScrollback)
    safelyDisposeTerminalResource('renderer subscription', unsubscribeRenderer)
    safelyDisposeTerminalResource('renderer addon', () => rendererController.dispose())
    safelyDisposeTerminalResource('resize observer', () => resizeObserver.disconnect())
    window.removeEventListener('mssh:terminal-host-moved', onHostMoved)
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

