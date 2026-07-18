import { CanvasAddon } from '@xterm/addon-canvas'
import { Terminal } from '@xterm/xterm'
import { logger } from '@/lib/logger'
import { xtermTheme } from '@/lib/terminalTheme'
import { useAppStore } from '@/store/appStore'

const TERMINAL_SCROLLBACK = 10000

export function createTerminalInstance() {
  const theme = useAppStore.getState().terminalTheme
  return new Terminal({
    allowProposedApi: true,
    cursorBlink: true,
    cursorInactiveStyle: 'none',
    cursorStyle: theme.cursorStyle,
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    theme: xtermTheme(theme),
    scrollback: TERMINAL_SCROLLBACK,
  })
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
