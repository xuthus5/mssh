import { useEffect, useRef, type RefObject } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { useAppStore } from '@/store/appStore'
import { onEvent } from '@/lib/wails'

export function useTerminal(
  terminalID: string,
  containerRef: RefObject<HTMLDivElement | null>,
) {
  const termRef = useRef<Terminal | null>(null)

  const store = useAppStore()

  useEffect(() => {
    const existing = store.terminalPool.get(terminalID)
    const term =
      existing?.terminal ??
      new Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontSize: 14,
        fontFamily: '"JetBrains Mono", "Cascadia Code", monospace',
        theme: {
          background: '#0d1117',
          foreground: '#c9d1d9',
          cursor: '#c9d1d9',
          cursorAccent: '#0d1117',
          selectionBackground: '#264f78',
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
        term.writeln('\x1b[90mType to begin — input is echoed locally until connected\x1b[0m')
        term.writeln('')
        store.setConnectionStatus(terminalID, 'disconnected')
      }
    }

    const dataDispose = term.onData((data) => {
      store.updateLastUsed(terminalID)
      term.write(data)
      console.log('[Terminal] input:', JSON.stringify(data))
    })

    const disposeEvent = onEvent('terminal:output', (payload: unknown) => {
      const p = payload as { terminal_id?: string; data?: number[] }
      if (p?.terminal_id === terminalID && p?.data) {
        const bytes = new Uint8Array(p.data)
        term.write(bytes)
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
      disposeEvent()
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

  return termRef
}
