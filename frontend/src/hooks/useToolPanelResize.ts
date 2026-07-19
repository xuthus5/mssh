import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'

export type ToolPanelKind = 'history' | 'files' | 'system' | 'ai'

const MIN_WIDTH = 280
const MAX_WIDTH = 720
const KEYBOARD_STEP = 24
const DEFAULT_WIDTHS: Record<ToolPanelKind, number> = { history: 340, files: 340, system: 440, ai: 420 }

function clampWidth(width: number): number {
  if (!Number.isFinite(width)) return MIN_WIDTH
  return Math.min(Math.max(width, MIN_WIDTH), MAX_WIDTH)
}

function storageKey(kind: ToolPanelKind): string {
  return `mssh:tool-panel-width:${kind}`
}

function initialWidth(kind: ToolPanelKind): number {
  const persisted = localStorage.getItem(storageKey(kind))
  return persisted === null ? DEFAULT_WIDTHS[kind] : clampWidth(Number(persisted))
}

export function useToolPanelResize(kind: ToolPanelKind) {
  const [width, setWidth] = useState(() => initialWidth(kind))
  const dragRef = useRef<{ pointerID: number; startX: number; startWidth: number } | null>(null)
  const resize = useCallback((nextWidth: number) => {
    const normalized = clampWidth(nextWidth)
    setWidth(normalized)
    localStorage.setItem(storageKey(kind), String(normalized))
  }, [kind])
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || drag.pointerID !== event.pointerId) return
      resize(drag.startWidth + drag.startX - event.clientX)
    }
    const stop = (event: PointerEvent) => { if (dragRef.current?.pointerID === event.pointerId) dragRef.current = null }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop) }
  }, [resize])
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    dragRef.current = { pointerID: event.pointerId, startX: event.clientX, startWidth: width }
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowLeft') resize(width + KEYBOARD_STEP)
    else if (event.key === 'ArrowRight') resize(width - KEYBOARD_STEP)
    else if (event.key === 'Home') resize(DEFAULT_WIDTHS[kind])
    else return
    event.preventDefault()
  }
  const panelStyle: CSSProperties = { width, maxWidth: 'calc(100% - 120px)' }
  return { width, panelStyle, resizeHandleProps: { onPointerDown, onDoubleClick: () => resize(DEFAULT_WIDTHS[kind]), onKeyDown, role: 'separator' as const, tabIndex: 0, 'aria-label': '调整工具面板宽度', 'aria-orientation': 'vertical' as const, 'aria-valuemin': MIN_WIDTH, 'aria-valuemax': MAX_WIDTH, 'aria-valuenow': width } }
}
