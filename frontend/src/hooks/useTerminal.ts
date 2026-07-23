import { useEffect, useRef, type RefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import { useTerminalRuntimeErrorReporter } from '@/components/terminal/TerminalErrorBoundary'
import { useAppStore } from '@/store/appStore'
import { useTerminalActivation, useTerminalAttachment, useTerminalIdentity } from '@/hooks/terminalLifecycleRuntime'
import {
  initializeTerminal,
  recoverTerminal,
  type TerminalLifecycleRefs,
} from '@/hooks/terminalMountRuntime'

export interface TerminalFocusRequest {
  sequence: number
  targetTerminalID?: string | null
}

interface UseTerminalOptions {
  active: boolean
  focusRequest: TerminalFocusRequest
}

function useTerminalLifecycle(containerRef: RefObject<HTMLDivElement | null>, refs: TerminalLifecycleRefs, reportRuntimeError: ReturnType<typeof useTerminalRuntimeErrorReporter>) {
  useEffect(() => initializeTerminal(containerRef, refs, reportRuntimeError), [containerRef, reportRuntimeError])
}

export function useTerminal(terminalID: string, containerRef: RefObject<HTMLDivElement | null>, { active, focusRequest }: UseTerminalOptions) {
  const reportRuntimeError = useTerminalRuntimeErrorReporter()
  const refs: TerminalLifecycleRefs = {
    termRef: useRef<Terminal | null>(null),
    fitAddonRef: useRef<import("@xterm/addon-fit").FitAddon | null>(null),
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
    outputFlushRef: useRef<(() => void) | null>(null),
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
  useEffect(() => {
    if (!active) return
    refs.outputFlushRef.current?.()
  }, [active])
  useTerminalActivation({ refs, active, sequence: focusRequest.sequence, reportRuntimeError,
    recover: (term, fitAddon) => recoverTerminal({ term, fitAddon, container: containerRef.current, refs }) })
  return refs.termRef
}
