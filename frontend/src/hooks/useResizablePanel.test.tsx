import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useResizablePanel } from '@/hooks/useResizablePanel'
import { useAppStore } from '@/store/appStore'

describe('useResizablePanel', () => {
  beforeEach(() => {
    localStorage.clear()
    useAppStore.setState({ navigationCollapsed: false, sidebarWidth: 280 })
  })

  it('updates the shared sidebar width and persists it while dragging', () => {
    const { result } = renderHook(() => useResizablePanel())
    act(() => {
      result.current.resizeHandleProps.onPointerDown({ button: 0, pointerId: 1, clientX: 280, preventDefault() {} } as never)
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 380 }))
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }))
    })
    expect(useAppStore.getState().sidebarWidth).toBe(380)
    expect(localStorage.getItem('mssh:sidebar-width')).toBe('380')

    act(() => result.current.resizeHandleProps.onDoubleClick())
    expect(useAppStore.getState().sidebarWidth).toBe(280)
    expect(localStorage.getItem('mssh:sidebar-width')).toBe('280')
  })

  it('uses the shared sidebar width', () => {
    useAppStore.setState({ sidebarWidth: 480 })
    const { result } = renderHook(() => useResizablePanel())
    expect(result.current.width).toBe(480)
  })

  it('disables the resize handle while navigation is collapsed', () => {
    useAppStore.setState({ navigationCollapsed: true })
    const { result } = renderHook(() => useResizablePanel())
    expect(result.current.resizeHandleProps.tabIndex).toBe(-1)
  })
})
