import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'

function hasVisibleSize(container: HTMLDivElement | null): container is HTMLDivElement {
  return container !== null && container.clientWidth > 0 && container.clientHeight > 0
}

export function fitAndRefresh(term: Terminal, fitAddon: FitAddon, container: HTMLDivElement | null) {
  if (!hasVisibleSize(container)) return false
  const dimensions = fitAddon.proposeDimensions()
  if (!dimensions || dimensions.cols < 1 || dimensions.rows < 1) return false
  fitAddon.fit()
  term.refresh(0, term.rows - 1)
  return true
}
