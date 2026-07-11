import { useEffect, useRef, type RefObject } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useAppStore } from '@/store/appStore'
import { TerminalService } from '@/lib/wails'
import { Events } from '@wailsio/runtime'
import { logger } from '@/lib/logger'
import { applyTerminalTheme, xtermTheme } from '@/lib/terminalTheme'

interface TerminalOutputEvent {
  terminal_id?: string
  data?: string
}

export function useTerminal(
  terminalID: string,
  containerRef: RefObject<HTMLDivElement | null>,
  active: boolean,
) {
  const termRef = useRef<Terminal | null>(null)
  const storeRef = useRef(useAppStore.getState())
  const activeRef = useRef(active)
  storeRef.current = useAppStore.getState()
  activeRef.current = active

  useEffect(() => {
    const initialTheme = useAppStore.getState().terminalTheme
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: initialTheme.cursorStyle,
      fontSize: initialTheme.fontSize,
      fontFamily: initialTheme.fontFamily,
      theme: xtermTheme(initialTheme),
      scrollback: 10000,
    })

    termRef.current = term

    const fitAddon = new FitAddon()

    let initialResizeTimer: number | undefined
    if (containerRef.current) {
      term.open(containerRef.current)
      term.loadAddon(fitAddon)
      initialResizeTimer = window.setTimeout(() => {
        fitAddon.fit()
        if (activeRef.current) {
          term.focus()
          storeRef.current.setActivePane(terminalID)
        }
        TerminalService.Resize(terminalID, term.cols, term.rows).catch((err: unknown) => {
          logger.error('terminal initial resize error', err)
        })
        logger.debug('terminal opened', { cols: term.cols, rows: term.rows })
      }, 100)
      storeRef.current.registerTerminal(terminalID, term)
    }

    const focusHandler = () => storeRef.current.setActivePane(terminalID)
    containerRef.current?.addEventListener('focusin', focusHandler)
    containerRef.current?.addEventListener('pointerdown', focusHandler)

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
        TerminalService.Resize(terminalID, term.cols, term.rows).catch((err: unknown) => {
          logger.error('terminal resize error', err)
        })
      }
    })
    if (containerRef.current) {
      resizeObs.observe(containerRef.current)
    }

    return () => {
      if (initialResizeTimer !== undefined) window.clearTimeout(initialResizeTimer)
      dataDispose.dispose()
      unsubOutput()
      resizeObs.disconnect()
      containerRef.current?.removeEventListener('focusin', focusHandler)
      containerRef.current?.removeEventListener('pointerdown', focusHandler)
      storeRef.current.unregisterTerminal(terminalID)
      term.dispose()
    }
  }, [terminalID, containerRef])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    if (active) term.focus()
    else term.blur()
  }, [active])

  useEffect(() => {
    const unsub = useAppStore.subscribe((state, prevState) => {
      const t = termRef.current
      if (!t) return
      if (state.terminalTheme === prevState.terminalTheme) return
      const tm = state.terminalTheme
      applyTerminalTheme(t.options, tm)
    })
    return unsub
  }, [])

  return termRef
}
