import { useEffect, useRef, type RefObject } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { useAppStore } from '@/store/appStore'
import { TerminalService } from '@/lib/wails'
import { Events } from '@wailsio/runtime'
import { logger } from '@/lib/logger'

interface TerminalOutputEvent {
  terminal_id?: string
  data?: string
}

export function useTerminal(
  terminalID: string,
  containerRef: RefObject<HTMLDivElement | null>,
) {
  const termRef = useRef<Terminal | null>(null)
  const storeRef = useRef(useAppStore.getState())
  storeRef.current = useAppStore.getState()

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Cascadia Code", monospace',
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#c9d1d9',
        cursorAccent: '#0d1117',
      },
      scrollback: 10000,
    })

    termRef.current = term

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    try {
      const webglAddon = new WebglAddon()
      term.loadAddon(webglAddon)
    } catch {
      // WebGL not available, fallback to Canvas renderer
    }

    if (containerRef.current) {
      term.open(containerRef.current)
      setTimeout(() => {
        fitAddon.fit()
        term.focus()
        logger.debug('terminal opened', { cols: term.cols, rows: term.rows })
      }, 100)

      term.writeln('\x1b[1;36m╔════════════════════════════════════════╗')
      term.writeln('\x1b[1;36m║          Welcome to MSSH              ║')
      term.writeln('\x1b[1;36m║    Secure Shell Client & Manager      ║')
      term.writeln('\x1b[1;36m╚════════════════════════════════════════╝\x1b[0m')
      term.writeln('')
      term.writeln('\x1b[33mWaiting for SSH connection...\x1b[0m')
      term.writeln('')
      storeRef.current.setConnectionStatus(terminalID, 'disconnected')
    }

    const dataDispose = term.onData((data) => {
      storeRef.current.updateLastUsed(terminalID)
      TerminalService.Write(terminalID, data).catch((err: unknown) => {
        logger.error('terminal write error', err)
      })
    })

    let eventCount = 0
    logger.debug('subscribing to terminal:output for', terminalID)
    const unsubOutput = Events.On('terminal:output', (wailsEvent: { data?: TerminalOutputEvent }) => {
      eventCount++
      const p = wailsEvent?.data
      if (p?.terminal_id === terminalID) {
        if (p.data !== undefined && p.data !== null && p.data.length > 0) {
          if (eventCount <= 3) {
            const preview = p.data.length > 60 ? p.data.slice(0, 60) + '...' : p.data
            logger.debug(`#${eventCount} writing ${p.data.length}B`, { text: preview })
          }
          term.write(p.data)
        }
      }
    })

    const resizeObs = new ResizeObserver(() => {
      if (containerRef.current) {
        fitAddon.fit()
      }
    })
    if (containerRef.current) {
      resizeObs.observe(containerRef.current)
    }

    return () => {
      dataDispose.dispose()
      unsubOutput()
      resizeObs.disconnect()
      try {
        const el = term.element
        if (el?.parentNode) {
          el.parentNode.removeChild(el)
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }, [terminalID, containerRef])

  useEffect(() => {
    const unsub = useAppStore.subscribe((state, prevState) => {
      const t = termRef.current
      if (!t) return
      if (state.terminalTheme === prevState.terminalTheme) return
      const tm = state.terminalTheme
      t.options.cursorStyle = tm.cursorStyle
      t.options.fontSize = tm.fontSize
      t.options.fontFamily = tm.fontFamily
      t.options.theme = {
        background: tm.background,
        foreground: tm.foreground,
        cursor: tm.cursor,
        cursorAccent: tm.cursorAccent,
        selectionBackground: tm.selectionBackground,
        black: tm.ansiBlack,
        red: tm.ansiRed,
        green: tm.ansiGreen,
        yellow: tm.ansiYellow,
        blue: tm.ansiBlue,
        magenta: tm.ansiMagenta,
        cyan: tm.ansiCyan,
        white: tm.ansiWhite,
        brightBlack: tm.ansiBrightBlack,
        brightRed: tm.ansiBrightRed,
        brightGreen: tm.ansiBrightGreen,
        brightYellow: tm.ansiBrightYellow,
        brightBlue: tm.ansiBrightBlue,
        brightMagenta: tm.ansiBrightMagenta,
        brightCyan: tm.ansiBrightCyan,
        brightWhite: tm.ansiBrightWhite,
      }
    })
    return unsub
  }, [])

  return termRef
}
