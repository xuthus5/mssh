import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'

interface DragState {
  pointerId: number
  startX: number
  startY: number
  originLeft: number
  originTop: number
  width: number
  height: number
}

const VIEWPORT_MARGIN = 12

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

export function useDraggableDialog(open: boolean) {
  const contentRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)

  useEffect(() => {
    if (open || !contentRef.current) return
    const element = contentRef.current
    element.style.removeProperty('left')
    element.style.removeProperty('top')
    element.style.removeProperty('transform')
    element.style.removeProperty('transition')
    element.style.removeProperty('animation')
  }, [open])

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current
      const element = contentRef.current
      if (!drag || !element || event.pointerId !== drag.pointerId) return
      const left = clamp(drag.originLeft + event.clientX - drag.startX, VIEWPORT_MARGIN, window.innerWidth - VIEWPORT_MARGIN - drag.width)
      const top = clamp(drag.originTop + event.clientY - drag.startY, VIEWPORT_MARGIN, window.innerHeight - VIEWPORT_MARGIN - drag.height)
      element.style.left = `${left}px`
      element.style.top = `${top}px`
    }
    const handleUp = (event: PointerEvent) => {
      if (dragRef.current?.pointerId !== event.pointerId) return
      dragRef.current = null
      contentRef.current?.style.removeProperty('cursor')
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

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const element = contentRef.current
    if (event.button !== 0 || !element) return
    event.preventDefault()
    const rect = element.getBoundingClientRect()
    element.style.left = `${rect.left}px`
    element.style.top = `${rect.top}px`
    element.style.transform = 'none'
    element.style.transition = 'none'
    element.style.animation = 'none'
    element.style.cursor = 'grabbing'
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      width: rect.width,
      height: rect.height,
    }
  }

  return { contentRef, dragHandleProps: { onPointerDown: startDrag } }
}
