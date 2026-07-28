import { useEffect, useMemo, useRef } from 'react'

export function useAITerminalRuntime() {
  const lifecycle = useRef(0)
  const targetGeneration = useRef(0)
  const panelRequest = useRef(0)
  const dashboardRequest = useRef(0)
  const catalogRequest = useRef(0)
  const historyRequest = useRef(0)
  const sendRequest = useRef(0)
  const sendActive = useRef(false)
  const source = useRef(Symbol('ai-terminal-panel'))
  useEffect(() => {
    const token = ++lifecycle.current
    return () => {
      if (lifecycle.current !== token) return
      lifecycle.current++
      catalogRequest.current++
      sendRequest.current++
      sendActive.current = false
    }
  }, [])
  return useMemo(() => ({
    lifecycle, targetGeneration, panelRequest, dashboardRequest, catalogRequest, historyRequest, sendRequest, sendActive,
    source: source.current,
    isCurrent: (generation: number) => targetGeneration.current === generation,
  }), [])
}

export type AITerminalRuntime = ReturnType<typeof useAITerminalRuntime>
