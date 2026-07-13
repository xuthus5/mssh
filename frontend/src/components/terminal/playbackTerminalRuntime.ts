import type { RefObject } from 'react'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import type { TerminalRuntimeErrorReporter } from '@/components/terminal/TerminalErrorBoundary'
import { runTerminalRuntime } from '@/components/terminal/terminalRuntime'

export function hasVisiblePlaybackSize(container: HTMLDivElement | null): container is HTMLDivElement {
  return container !== null && container.clientWidth > 0 && container.clientHeight > 0
}

export function recoverPlaybackView(term: Terminal, fitAddon: FitAddon, container: HTMLDivElement | null): boolean {
  if (!hasVisiblePlaybackSize(container)) return false
  fitAddon.fit()
  term.refresh(0, term.rows - 1)
  return true
}

export function createPlaybackResizeObserver({
  term,
  fitAddon,
  containerRef,
  activeRef,
  recoveryPendingRef,
  reportRuntimeError,
}: {
  term: Terminal
  fitAddon: FitAddon
  containerRef: RefObject<HTMLDivElement | null>
  activeRef: RefObject<boolean>
  recoveryPendingRef: RefObject<boolean>
  reportRuntimeError: TerminalRuntimeErrorReporter
}) {
  return new ResizeObserver(() => {
    runTerminalRuntime(reportRuntimeError, 'playback resize', () => {
      if (!activeRef.current) return
      if (recoveryPendingRef.current) {
        if (recoverPlaybackView(term, fitAddon, containerRef.current)) recoveryPendingRef.current = false
        return
      }
      if (hasVisiblePlaybackSize(containerRef.current)) fitAddon.fit()
    })
  })
}
