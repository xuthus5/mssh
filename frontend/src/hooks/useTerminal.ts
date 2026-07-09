import { useEffect, type RefObject } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { useAppStore } from '@/store/appStore'

export function useTerminal(
  terminalID: string,
  containerRef: RefObject<HTMLDivElement | null>,
) {
  const store = useAppStore()

  useEffect(() => {
    const pooled = store.terminalPool.get(terminalID)
    const term =
      pooled?.terminal ??
      new Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontSize: 14,
        fontFamily: '"JetBrains Mono", "Cascadia Code", monospace',
        theme: {
          background: '#0d1117',
          foreground: '#c9d1d9',
        },
        allowProposedApi: true,
        allowTransparency: false,
        scrollback: 10000,
      })

    if (!pooled) {
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
    }

    const dataDispose = term.onData((data) => {
      store.updateLastUsed(terminalID)
      // Wails binding stub: Wails.TerminalService.Write(terminalID, data)
      console.debug('[terminal:input]', terminalID, data)
    })

    const resizeObs = new ResizeObserver(() => {
      if (containerRef.current) {
        fitAddon.fit()
        // Wails binding stub: Wails.TerminalService.Resize(terminalID, term.cols, term.rows)
      }
    })
    if (containerRef.current) {
      resizeObs.observe(containerRef.current)
    }

    return () => {
      dataDispose.dispose()
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
}
