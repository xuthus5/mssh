import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useResizablePanel } from '@/hooks/useResizablePanel'

describe('useResizablePanel', () => {
  beforeEach(() => localStorage.clear())

  it('resizes within limits and persists the width', () => {
    const { result } = renderHook(() => useResizablePanel())
    act(() => {
      result.current.resizeHandleProps.onPointerDown({ button: 0, pointerId: 1, clientX: 280, preventDefault() {} } as never)
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 380 }))
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }))
    })
    expect(result.current.width).toBe(380)

    act(() => result.current.resizeHandleProps.onDoubleClick())
    expect(result.current.width).toBe(280)
    expect(localStorage.getItem('mssh:sidebar-width')).toBe('280')
  })

  it('restores and clamps a saved width', () => {
    localStorage.setItem('mssh:sidebar-width', '999')
    const { result } = renderHook(() => useResizablePanel())
    expect(result.current.width).toBe(480)
  })

  it('collapses, persists, and restores the previous width', () => {
    const { result } = renderHook(() => useResizablePanel())
    act(() => result.current.resizeHandleProps.onDoubleClick())
    act(() => result.current.toggleCollapsed())
    expect(result.current.collapsed).toBe(true)
    expect(result.current.displayedWidth).toBe(0)
    expect(localStorage.getItem('mssh:sidebar-collapsed')).toBe('true')

    act(() => result.current.toggleCollapsed())
    expect(result.current.collapsed).toBe(false)
    expect(result.current.displayedWidth).toBe(280)
  })
})
