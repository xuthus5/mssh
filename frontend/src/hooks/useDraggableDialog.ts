import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

interface Point { x: number; y: number }

const VIEWPORT_MARGIN = 12

export function useDraggableDialog(open: boolean) {
  const contentRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; start: Point; origin: Point; rect: DOMRect } | null>(null)
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })

  useEffect(() => {
    if (!open) setOffset({ x: 0, y: 0 })
  }, [open])

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return
      const deltaX = event.clientX - drag.start.x
      const deltaY = event.clientY - drag.start.y
      setOffset({
        x: drag.origin.x + Math.min(Math.max(deltaX, VIEWPORT_MARGIN - drag.rect.left), window.innerWidth - VIEWPORT_MARGIN - drag.rect.right),
        y: drag.origin.y + Math.min(Math.max(deltaY, VIEWPORT_MARGIN - drag.rect.top), window.innerHeight - VIEWPORT_MARGIN - drag.rect.bottom),
      })
    }
    const handleUp = (event: PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
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
    if (event.button !== 0 || !contentRef.current) return
    event.preventDefault()
    dragRef.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      origin: offset,
      rect: contentRef.current.getBoundingClientRect(),
    }
  }

  return {
    contentRef,
    dragHandleProps: { onPointerDown: startDrag },
    style: { transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))` },
  }
}
