import type { RefObject } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import type { Terminal } from '@xterm/xterm'
import type { TerminalRuntimeErrorReporter } from '@/components/terminal/TerminalErrorBoundary'
import { installTerminalCopyOnSelect } from '@/components/terminal/terminalBehaviorRuntime'
import { installCommandTokenPredict } from '@/components/terminal/terminalHistoryPredictRuntime'
import { runTerminalRuntime } from '@/components/terminal/terminalRuntime'
import { subscribeToRenderer, subscribeToScrollback } from '@/hooks/terminalBehaviorSubscriptions'
import { subscribeToTerminalWorkingDirectory } from '@/hooks/terminalDirectoryRuntime'
import { fitAndRefresh } from '@/hooks/terminalFitRuntime'
import { resolveSessionId, subscribeToTerminalData } from '@/hooks/terminalInputRuntime'
import { createTerminalInstance, createTerminalRendererController, safelyDisposeTerminalResource } from '@/hooks/terminalInstanceRuntime'
import { subscribeToSynchronizedOutputQuery, subscribeToTerminalOutput, subscribeToTerminalVersionQuery } from '@/hooks/terminalOutputRuntime'
import type { TerminalLifecycleRefs } from '@/hooks/terminalMountRuntime'
import { TerminalCommandCapture } from '@/lib/terminalCommandCapture'
import { registerTerminalSearch, unregisterTerminalSearch } from '@/lib/terminalSearchRegistry'
import { createTerminalKeywordHighlightController } from '@/hooks/useTerminalKeywordHighlight'
import { TerminalService } from '@/lib/wails'
import { useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'

type MountOptions = {
  containerRef: RefObject<HTMLDivElement | null>
  refs: TerminalLifecycleRefs
  reportRuntimeError: TerminalRuntimeErrorReporter
  writeTerminalInput: (data: string, refs: TerminalLifecycleRefs) => void
  cancelActivationFrame: (frameRef: RefObject<number | null>) => void
  scheduleBackendResize: (term: Terminal, refs: TerminalLifecycleRefs) => void
  subscribeToTheme: (options: ThemeSubscriptionOptions) => () => void
  observeResize: (options: ThemeSubscriptionOptions) => ResizeObserver
}

type ThemeSubscriptionOptions = {
  term: Terminal
  fitAddon: FitAddon
  containerRef: RefObject<HTMLDivElement | null>
  refs: TerminalLifecycleRefs
  reportRuntimeError: TerminalRuntimeErrorReporter
}

type BaseResources = {
  container: HTMLDivElement | null
  term: Terminal
  fitAddon: FitAddon
  unicodeAddon: Unicode11Addon
  searchAddon: SearchAddon
  rendererController: ReturnType<typeof createTerminalRendererController>
  cleanupCopyOnSelect?: () => void
  owned: { fit: boolean; unicode: boolean; search: boolean }
}

function createBaseResources(options: MountOptions): BaseResources {
  const { containerRef, refs } = options
  const container = containerRef.current
  const term = createTerminalInstance()
  const fitAddon = new FitAddon()
  const unicodeAddon = new Unicode11Addon()
  const searchAddon = new SearchAddon({ highlightLimit: 1000 })
  const rendererController = createTerminalRendererController(term)
  const owned = { fit: false, unicode: false, search: false }
  let cleanupCopyOnSelect: (() => void) | undefined
  refs.termRef.current = term
  refs.fitAddonRef.current = fitAddon
  if (container) {
    term.open(container)
    rendererController.apply(useTerminalBehaviorStore.getState().renderer)
    term.loadAddon(unicodeAddon)
    owned.unicode = true
    if (term.unicode) term.unicode.activeVersion = '11'
    term.loadAddon(searchAddon)
    owned.search = true
    registerTerminalSearch(refs.terminalIDRef.current, searchAddon)
    cleanupCopyOnSelect = installTerminalCopyOnSelect(term, 'terminal')
    term.loadAddon(fitAddon)
    owned.fit = true
    refs.storeRef.current.registerTerminal(refs.terminalIDRef.current, term)
  }
  return { container, term, fitAddon, unicodeAddon, searchAddon, rendererController, cleanupCopyOnSelect, owned }
}

function createInputSubscriptions(options: MountOptions, resources: BaseResources) {
  const { refs, reportRuntimeError } = options
  const { term } = resources
  const commandCapture = new TerminalCommandCapture()
  const historyPredict = installCommandTokenPredict(term, {
    getSessionId: () => resolveSessionId(refs),
    getBuffer: () => commandCapture.current(),
    applyCompletion: (data) => {
      options.writeTerminalInput(data, refs)
      commandCapture.feed(data)
    },
  })
  const focusHandler = () => runTerminalRuntime(reportRuntimeError, 'terminal pane activation', () => {
    refs.storeRef.current.setActivePane(refs.terminalIDRef.current)
  })
  resources.container?.addEventListener('focusin', focusHandler)
  resources.container?.addEventListener('pointerdown', focusHandler)
  const dataDispose = subscribeToTerminalData(term, refs, commandCapture, (data) => options.writeTerminalInput(data, refs))
  const predictObserve = term.onData(() => historyPredict.update())
  return { historyPredict, predictObserve, focusHandler, dataDispose }
}

function createRuntimeSubscriptions(options: MountOptions, resources: BaseResources) {
  const { refs, reportRuntimeError, containerRef } = options
  const { term, fitAddon } = resources
  const keywordHighlight = createTerminalKeywordHighlightController({ reportRuntimeError })
  const outputSubscription = subscribeToTerminalOutput({
    term, terminalIDRef: refs.terminalIDRef, reportRuntimeError,
    shouldCoalesce: () => !refs.activeRef.current,
    setOutputPaused: typeof TerminalService.SetOutputPaused === 'function'
      ? async (terminalID, paused) => { await TerminalService.SetOutputPaused(terminalID, paused) }
      : undefined,
    outputTransform: keywordHighlight.transform,
    outputFlush: keywordHighlight.flush,
  })
  refs.outputFlushRef.current = () => outputSubscription.flush()
  const unsubscribeTheme = options.subscribeToTheme({ term, fitAddon, containerRef, refs, reportRuntimeError })
  const resizeObserver = options.observeResize({ term, fitAddon, containerRef, refs, reportRuntimeError })
  if (resources.container) resizeObserver.observe(resources.container)
  return {
    synchronizedOutputQueryDispose: subscribeToSynchronizedOutputQuery(term),
    terminalVersionQueryDispose: subscribeToTerminalVersionQuery(term),
    terminalDirectoryDispose: subscribeToTerminalWorkingDirectory(term, refs.terminalIDRef),
    outputSubscription,
    keywordHighlightDispose: keywordHighlight.dispose,
    unsubscribeTheme,
    unsubscribeScrollback: subscribeToScrollback(term, reportRuntimeError),
    unsubscribeRenderer: subscribeToRenderer((mode) => resources.rendererController.apply(mode), reportRuntimeError),
    resizeObserver,
  }
}

function createHostMovedHandler(options: MountOptions, resources: BaseResources, disposed: RefObject<boolean>) {
  const { refs, reportRuntimeError, containerRef } = options
  const { term, fitAddon, rendererController } = resources
  return (event: Event) => {
    const detail = (event as CustomEvent<{ terminalID?: string }>).detail
    if (!detail?.terminalID || detail.terminalID !== refs.terminalIDRef.current) return
    options.cancelActivationFrame(refs.activationFrameRef)
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
        options.scheduleBackendResize(term, refs)
      })
      if (!succeeded || recovered || attempts >= 30 || disposed.current) return
      refs.activationFrameRef.current = window.requestAnimationFrame(recoverMovedHost)
    }
    refs.activationFrameRef.current = window.requestAnimationFrame(recoverMovedHost)
  }
}

function disposeMount(context: {
  options: MountOptions
  resources: BaseResources
  subscriptions: ReturnType<typeof createRuntimeSubscriptions>
  input: ReturnType<typeof createInputSubscriptions>
}) {
  const { options, resources, subscriptions, input } = context
  const { refs } = options
  refs.outputFlushRef.current = null
  options.cancelActivationFrame(refs.activationFrameRef)
  if (refs.resizeTimerRef.current !== null) window.clearTimeout(refs.resizeTimerRef.current)
  resources.container?.removeEventListener('focusin', input.focusHandler)
  resources.container?.removeEventListener('pointerdown', input.focusHandler)
  safelyDisposeTerminalResource('history predict', input.historyPredict.dispose)
  safelyDisposeTerminalResource('data subscription', () => input.dataDispose.dispose())
  safelyDisposeTerminalResource('predict observe', () => input.predictObserve.dispose())
  safelyDisposeTerminalResource('synchronized output query', () => subscriptions.synchronizedOutputQueryDispose.dispose())
  safelyDisposeTerminalResource('terminal version query', () => subscriptions.terminalVersionQueryDispose.dispose())
  safelyDisposeTerminalResource('terminal working directory', () => subscriptions.terminalDirectoryDispose.dispose())
  safelyDisposeTerminalResource('output subscription', subscriptions.outputSubscription.dispose)
  safelyDisposeTerminalResource('keyword highlight', () => subscriptions.keywordHighlightDispose())
  safelyDisposeTerminalResource('theme subscription', subscriptions.unsubscribeTheme)
  safelyDisposeTerminalResource('scrollback subscription', subscriptions.unsubscribeScrollback)
  safelyDisposeTerminalResource('renderer subscription', subscriptions.unsubscribeRenderer)
  safelyDisposeTerminalResource('renderer addon', () => resources.rendererController.dispose())
  safelyDisposeTerminalResource('resize observer', () => subscriptions.resizeObserver.disconnect())
  if (resources.cleanupCopyOnSelect) safelyDisposeTerminalResource('copy-on-select subscription', resources.cleanupCopyOnSelect)
  unregisterTerminalSearch(refs.registeredTerminalIDRef.current)
  if (!resources.owned.fit) safelyDisposeTerminalResource('fit addon', () => resources.fitAddon.dispose())
  if (!resources.owned.unicode) safelyDisposeTerminalResource('unicode addon', () => resources.unicodeAddon.dispose())
  if (!resources.owned.search) safelyDisposeTerminalResource('search addon', () => resources.searchAddon.dispose())
  refs.storeRef.current.unregisterTerminal(refs.terminalIDRef.current)
  safelyDisposeTerminalResource('instance', () => resources.term.dispose())
  refs.fitAddonRef.current = null
  refs.termRef.current = null
}

export function createTerminalMountSession(options: MountOptions) {
  const disposed = { current: false }
  const resources = createBaseResources(options)
  const input = createInputSubscriptions(options, resources)
  const subscriptions = createRuntimeSubscriptions(options, resources)
  const onHostMoved = createHostMovedHandler(options, resources, disposed)
  window.addEventListener('mssh:terminal-host-moved', onHostMoved)
  return () => {
    if (disposed.current) return
    disposed.current = true
    window.removeEventListener('mssh:terminal-host-moved', onHostMoved)
    disposeMount({ options, resources, subscriptions, input })
  }
}
