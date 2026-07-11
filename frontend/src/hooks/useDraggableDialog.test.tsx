import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useDraggableDialog } from '@/hooks/useDraggableDialog'

describe('useDraggableDialog', () => {
  it('moves from the header and resets when reopened', () => {
    const { result, rerender } = renderHook(({ open }) => useDraggableDialog(open), { initialProps: { open: true } })
    const element = document.createElement('div')
    element.getBoundingClientRect = () => ({ left: 200, right: 800, top: 100, bottom: 600, width: 600, height: 500, x: 200, y: 100, toJSON: () => ({}) })
    Object.defineProperty(result.current.contentRef, 'current', { value: element, configurable: true })

    act(() => {
      result.current.dragHandleProps.onPointerDown({ button: 0, pointerId: 1, clientX: 300, clientY: 150, preventDefault() {} } as never)
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 360, clientY: 190 }))
    })
    expect(result.current.style?.transform).toContain('60px')
    expect(result.current.style?.transform).toContain('40px')

    rerender({ open: false })
    expect(result.current.style).toBeUndefined()
    rerender({ open: true })
    expect(result.current.style).toBeUndefined()
  })

  it('keeps the dialog native centered style untouched before dragging', () => {
    const { result } = renderHook(() => useDraggableDialog(true))
    expect(result.current.style).toBeUndefined()
  })
})
