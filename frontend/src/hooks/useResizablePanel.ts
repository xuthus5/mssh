import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'

const DEFAULT_WIDTH = 280
const MIN_WIDTH = 220
const MAX_WIDTH = 480
const STORAGE_KEY = 'mssh:sidebar-width'
const KEYBOARD_STEP = 16

function clampWidth(width: number) {
  return Math.min(Math.max(width, MIN_WIDTH), MAX_WIDTH)
}

function initialWidth() {
  const saved = Number(localStorage.getItem(STORAGE_KEY))
  return Number.isFinite(saved) && saved > 0 ? clampWidth(saved) : DEFAULT_WIDTH
}

export function useResizablePanel() {
  const [width, setWidth] = useState(initialWidth)
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return
      const nextWidth = clampWidth(drag.startWidth + event.clientX - drag.startX)
      setWidth(nextWidth)
      localStorage.setItem(STORAGE_KEY, String(nextWidth))
    }
    const handleUp = (event: PointerEvent) => {
      if (dragRef.current?.pointerId !== event.pointerId) return
      dragRef.current = null
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
    }
  }, [])

  const resize = (nextWidth: number) => {
    const value = clampWidth(nextWidth)
    setWidth(value)
    localStorage.setItem(STORAGE_KEY, String(value))
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowLeft') resize(width - KEYBOARD_STEP)
    else if (event.key === 'ArrowRight') resize(width + KEYBOARD_STEP)
    else if (event.key === 'Home') resize(DEFAULT_WIDTH)
    else return
    event.preventDefault()
  }

  return {
    width,
    resizeHandleProps: {
      onPointerDown: handlePointerDown,
      onDoubleClick: () => resize(DEFAULT_WIDTH),
      onKeyDown: handleKeyDown,
      role: 'separator' as const,
      tabIndex: 0,
      'aria-label': '调整侧边栏宽度',
      'aria-orientation': 'vertical' as const,
      'aria-valuemin': MIN_WIDTH,
      'aria-valuemax': MAX_WIDTH,
      'aria-valuenow': width,
    },
  }
}
