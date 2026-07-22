import { CanvasAddon } from '@xterm/addon-canvas'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { logger } from '@/lib/logger'
import { xtermTheme } from '@/lib/terminalTheme'
import { useAppStore } from '@/store/appStore'
import {
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  normalizeScrollbackLines,
  normalizeTerminalRenderer,
  useTerminalBehaviorStore,
  type TerminalRenderer,
} from '@/store/terminalBehaviorStore'

export function resolveTerminalScrollbackLines(value?: unknown): number {
  if (value === undefined) {
    return normalizeScrollbackLines(useTerminalBehaviorStore.getState().scrollbackLines)
  }
  return normalizeScrollbackLines(value)
}

export function resolveTerminalRenderer(value?: unknown): TerminalRenderer {
  if (value === undefined) {
    return normalizeTerminalRenderer(useTerminalBehaviorStore.getState().renderer)
  }
  return normalizeTerminalRenderer(value)
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

export interface TerminalRendererController {
  apply: (mode: TerminalRenderer) => TerminalRenderer
  dispose: () => void
  mode: () => TerminalRenderer
}

/** Manage xterm renderer addons with graceful fallback. */
export function createTerminalRendererController(term: Terminal): TerminalRendererController {
  let current: TerminalRenderer = 'dom'
  let addon: { dispose: () => void } | null = null

  const disposeAddon = () => {
    if (!addon) return
    try {
      addon.dispose()
    } catch (error: unknown) {
      logger.warn('terminal renderer dispose failed', error)
    }
    addon = null
  }

  const loadAddon = (mode: 'canvas' | 'webgl'): boolean => {
    try {
      const next = mode === 'webgl' ? new WebglAddon() : new CanvasAddon()
      term.loadAddon(next)
      addon = next
      current = mode
      return true
    } catch (error: unknown) {
      logger.warn(`terminal ${mode} renderer unavailable`, error)
      return false
    }
  }

  const apply = (requested: TerminalRenderer): TerminalRenderer => {
    const mode = normalizeTerminalRenderer(requested)
    if (mode === current && (mode === 'dom' ? addon === null : addon !== null)) return current
    disposeAddon()
    if (mode === 'dom') {
      current = 'dom'
      return current
    }
    if (loadAddon(mode)) return current
    if (mode === 'webgl' && loadAddon('canvas')) return current
    current = 'dom'
    return current
  }

  return {
    apply,
    dispose: disposeAddon,
    mode: () => current,
  }
}

/** @deprecated Prefer createTerminalRendererController for selectable renderers. */
export function loadCanvasRenderer(term: Terminal) {
  createTerminalRendererController(term).apply('canvas')
}

export function safelyDisposeTerminalResource(label: string, dispose: () => void) {
  try {
    dispose()
  } catch (error: unknown) {
    logger.error(`terminal ${label} cleanup error`, error)
  }
}
