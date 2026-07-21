import { CanvasAddon } from '@xterm/addon-canvas'
import { Terminal } from '@xterm/xterm'
import { logger } from '@/lib/logger'
import { xtermTheme } from '@/lib/terminalTheme'
import { useAppStore } from '@/store/appStore'
import {
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  normalizeScrollbackLines,
  useTerminalBehaviorStore,
} from '@/store/terminalBehaviorStore'

export function resolveTerminalScrollbackLines(value?: unknown): number {
  if (value === undefined) {
    return normalizeScrollbackLines(useTerminalBehaviorStore.getState().scrollbackLines)
  }
  return normalizeScrollbackLines(value)
}

export function createTerminalInstance() {
  const theme = useAppStore.getState().terminalTheme
  const scrollback = resolveTerminalScrollbackLines()
  return new Terminal({
    allowProposedApi: true,
    cursorBlink: true,
    cursorInactiveStyle: 'none',
    cursorStyle: theme.cursorStyle,
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    theme: xtermTheme(theme),
    scrollback: scrollback || DEFAULT_TERMINAL_SCROLLBACK_LINES,
  })
}

export function applyTerminalScrollback(term: Terminal, scrollbackLines: number) {
  const next = resolveTerminalScrollbackLines(scrollbackLines)
  if (term.options.scrollback === next) return
  term.options.scrollback = next
}

export function loadCanvasRenderer(term: Terminal) {
  try {
    term.loadAddon(new CanvasAddon())
  } catch (error: unknown) {
    logger.warn('terminal canvas renderer unavailable, using DOM renderer', error)
  }
}

export function safelyDisposeTerminalResource(label: string, dispose: () => void) {
  try {
    dispose()
  } catch (error: unknown) {
    logger.error(`terminal ${label} cleanup error`, error)
  }
}
