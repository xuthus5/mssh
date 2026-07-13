import { useEffect, useRef, type RefObject } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { Events } from '@wailsio/runtime'
import { logger } from '@/lib/logger'
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
}

function hasVisibleSize(container: HTMLDivElement | null): container is HTMLDivElement {
  return container !== null && container.clientWidth > 0 && container.clientHeight > 0
}

function reportResize(terminalID: string, term: Terminal, context: string) {
  void TerminalService.Resize(terminalID, term.cols, term.rows).catch((error: unknown) => logger.error(context, error))
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

function subscribeToData(term: Terminal, terminalID: string, storeRef: RefObject<AppState>) {
  return term.onData((data) => {
    storeRef.current.updateLastUsed(terminalID)
    void TerminalService.Write(terminalID, data).catch((error: unknown) => logger.error('terminal write error', error))
  })
}

function subscribeToOutput(term: Terminal, terminalID: string) {
  return Events.On('terminal:output', (event: { data?: TerminalOutputEvent }) => {
    const payload = event.data
    if (payload?.terminal_id === terminalID && payload.data) term.write(payload.data)
  })
}

function subscribeToTheme(term: Terminal) {
  return useAppStore.subscribe((state, previous) => {
    if (state.terminalTheme !== previous.terminalTheme) applyTerminalTheme(term.options, state.terminalTheme)
  })
}

function observeResize({ term, fitAddon, terminalID, containerRef, activeRef }: {
  term: Terminal
  fitAddon: FitAddon
  terminalID: string
  containerRef: RefObject<HTMLDivElement | null>
  activeRef: RefObject<boolean>
}) {
  return new ResizeObserver(() => {
    if (!activeRef.current || !fitAndRefresh(term, fitAddon, containerRef.current)) return
    reportResize(terminalID, term, 'terminal resize error')
  })
}

function initializeTerminal(terminalID: string, containerRef: RefObject<HTMLDivElement | null>, refs: TerminalLifecycleRefs) {
  let disposed = false
  const container = containerRef.current
  const term = createTerminal()
  const fitAddon = new FitAddon()
  refs.termRef.current = term
  refs.fitAddonRef.current = fitAddon
  if (container) {
    term.open(container)
    term.loadAddon(fitAddon)
    refs.storeRef.current.registerTerminal(terminalID, term)
  }
  const focusHandler = () => refs.storeRef.current.setActivePane(terminalID)
  container?.addEventListener('focusin', focusHandler)
  container?.addEventListener('pointerdown', focusHandler)
  const dataDispose = subscribeToData(term, terminalID, refs.storeRef)
  const unsubOutput = subscribeToOutput(term, terminalID)
  const unsubscribeTheme = subscribeToTheme(term)
  const resizeObserver = observeResize({ term, fitAddon, terminalID, containerRef, activeRef: refs.activeRef })
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
    safelyDispose('fit addon', () => fitAddon.dispose())
    refs.storeRef.current.unregisterTerminal(terminalID)
    safelyDispose('instance', () => term.dispose())
    refs.fitAddonRef.current = null
    refs.termRef.current = null
  }
}

function useTerminalLifecycle(terminalID: string, containerRef: RefObject<HTMLDivElement | null>, refs: TerminalLifecycleRefs) {
  useEffect(() => initializeTerminal(terminalID, containerRef, refs), [containerRef, terminalID])
}

function useTerminalActivation({ terminalID, containerRef, refs, active, sequence }: {
  terminalID: string
  containerRef: RefObject<HTMLDivElement | null>
  refs: TerminalLifecycleRefs
  active: boolean
  sequence: number
}) {
  const handledSequenceRef = useRef(0)
  useEffect(() => {
    const term = refs.termRef.current
    if (!term) return
    cancelActivationFrame(refs.activationFrameRef)
    if (!active) {
      term.blur()
      return
    }
    refs.activationFrameRef.current = window.requestAnimationFrame(() => {
      refs.activationFrameRef.current = null
      const fitAddon = refs.fitAddonRef.current
      if (!fitAddon || !fitAndRefresh(term, fitAddon, containerRef.current)) return
      if (sequence > handledSequenceRef.current) {
        term.focus()
        refs.storeRef.current.setActivePane(terminalID)
        handledSequenceRef.current = sequence
      }
      reportResize(terminalID, term, 'terminal activation resize error')
    })
    return () => cancelActivationFrame(refs.activationFrameRef)
  }, [active, sequence])
}

export function useTerminal(terminalID: string, containerRef: RefObject<HTMLDivElement | null>, { active, focusRequest }: UseTerminalOptions) {
  const refs: TerminalLifecycleRefs = {
    termRef: useRef<Terminal | null>(null),
    fitAddonRef: useRef<FitAddon | null>(null),
    activationFrameRef: useRef<number | null>(null),
    activeRef: useRef(active),
    storeRef: useRef(useAppStore.getState()),
  }
  refs.activeRef.current = active
  refs.storeRef.current = useAppStore.getState()
  useTerminalLifecycle(terminalID, containerRef, refs)
  useTerminalActivation({ terminalID, containerRef, refs, active, sequence: focusRequest.sequence })
  return refs.termRef
}
