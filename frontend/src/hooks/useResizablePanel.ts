import { useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useAppStore } from '@/store/appStore'
import { t } from '@/i18n'


const DEFAULT_WIDTH = 280
const MIN_WIDTH = 220
const MAX_WIDTH = 480
const KEYBOARD_STEP = 16

export function useResizablePanel() {
  const width = useAppStore((state) => state.sidebarWidth)
  const collapsed = useAppStore((state) => state.navigationCollapsed)
  const setSidebarWidth = useAppStore((state) => state.setSidebarWidth)
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return
      setSidebarWidth(drag.startWidth + event.clientX - drag.startX)
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
  }, [setSidebarWidth])

  const resize = (nextWidth: number) => {
    setSidebarWidth(nextWidth)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || collapsed) return
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
    collapsed,
    displayedWidth: collapsed ? 0 : width,
    resizeHandleProps: {
      onPointerDown: handlePointerDown,
      onDoubleClick: () => resize(DEFAULT_WIDTH),
      onKeyDown: handleKeyDown,
      role: 'separator' as const,
      tabIndex: collapsed ? -1 : 0,
      'aria-label': t('调整侧边栏宽度'),
      'aria-orientation': 'vertical' as const,
      'aria-valuemin': MIN_WIDTH,
      'aria-valuemax': MAX_WIDTH,
      'aria-valuenow': width,
    },
  }
}
