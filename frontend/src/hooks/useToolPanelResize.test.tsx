import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useToolPanelResize } from '@/hooks/useToolPanelResize'

describe('useToolPanelResize', () => {
  beforeEach(() => localStorage.clear())

  it('resizes a right-side panel from its left edge and persists width', () => {
    const { result } = renderHook(() => useToolPanelResize('files'))
    act(() => {
      result.current.resizeHandleProps.onPointerDown({ button: 0, pointerId: 1, clientX: 700, preventDefault() {} } as never)
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 600 }))
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }))
    })
    expect(result.current.width).toBe(440)
    expect(localStorage.getItem('mssh:tool-panel-width:files')).toBe('440')
  })

  it('keeps independent defaults and supports keyboard reset', () => {
    const { result } = renderHook(() => useToolPanelResize('system'))
    expect(result.current.width).toBe(440)
    act(() => result.current.resizeHandleProps.onKeyDown({ key: 'ArrowLeft', preventDefault() {} } as never))
    expect(result.current.width).toBe(464)
    act(() => result.current.resizeHandleProps.onDoubleClick())
    expect(result.current.width).toBe(440)
  })

  it('clamps persisted widths', () => {
    localStorage.setItem('mssh:tool-panel-width:history', '999')
    const { result } = renderHook(() => useToolPanelResize('history'))
    expect(result.current.width).toBe(720)
  })
})
