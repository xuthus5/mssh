import { useEffect, useRef, type RefObject } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { useAppStore } from '@/store/appStore'
import { TerminalService } from '@/lib/wails'

export function useTerminal(
  terminalID: string,
  containerRef: RefObject<HTMLDivElement | null>,
) {
  const termRef = useRef<Terminal | null>(null)

  const store = useAppStore()

  useEffect(() => {
    const existing = store.terminalPool.get(terminalID)
    const theme = store.terminalTheme
    const term =
      existing?.terminal ??
      new Terminal({
        cursorBlink: true,
        cursorStyle: theme.cursorStyle,
        fontSize: theme.fontSize,
        fontFamily: theme.fontFamily,
        theme: {
          background: theme.background,
          foreground: theme.foreground,
          cursor: theme.cursor,
          cursorAccent: theme.cursorAccent,
          selectionBackground: theme.selectionBackground,
          black: theme.ansiBlack,
          red: theme.ansiRed,
          green: theme.ansiGreen,
          yellow: theme.ansiYellow,
          blue: theme.ansiBlue,
          magenta: theme.ansiMagenta,
          cyan: theme.ansiCyan,
          white: theme.ansiWhite,
          brightBlack: theme.ansiBrightBlack,
          brightRed: theme.ansiBrightRed,
          brightGreen: theme.ansiBrightGreen,
          brightYellow: theme.ansiBrightYellow,
          brightBlue: theme.ansiBrightBlue,
          brightMagenta: theme.ansiBrightMagenta,
          brightCyan: theme.ansiBrightCyan,
          brightWhite: theme.ansiBrightWhite,
        },
        allowProposedApi: true,
        allowTransparency: false,
        scrollback: 10000,
      })

    termRef.current = term

    if (!existing) {
      store.registerTerminal(terminalID, term)
    }

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
      fitAddon.fit()

      if (!existing) {
        term.writeln('\x1b[1;36m╔════════════════════════════════════════╗')
        term.writeln('\x1b[1;36m║          Welcome to MSSH              ║')
        term.writeln('\x1b[1;36m║    Secure Shell Client & Manager      ║')
        term.writeln('\x1b[1;36m╚════════════════════════════════════════╝\x1b[0m')
        term.writeln('')
        term.writeln('\x1b[33mWaiting for SSH connection...\x1b[0m')
        term.writeln('\x1b[90mType to begin — input is sent to remote host once connected\x1b[0m')
        term.writeln('')
        store.setConnectionStatus(terminalID, 'disconnected')
      }
    }

    const dataDispose = term.onData((data) => {
      store.updateLastUsed(terminalID)
      TerminalService.Write(terminalID, data).catch((_err: unknown) => {})
    })

    let unsubOutput: (() => void) | undefined
    const w = (window as any).wails
    if (w?.Events?.On) {
      console.log('[useTerminal] subscribing to terminal:output for', terminalID)
      unsubOutput = w.Events.On('terminal:output', (payload: unknown) => {
        console.log('[useTerminal] received terminal:output', payload)
        const p = payload as { terminal_id?: string; data?: string }
        if (p?.terminal_id === terminalID && p?.data) {
          term.write(p.data)
        }
      })
    }

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
      unsubOutput?.()
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
  }, [terminalID, containerRef, store])

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
