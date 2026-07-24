import { describe, expect, it, vi } from 'vitest'
import {
  reportTerminalClipboardError,
  TERMINAL_CLIPBOARD_ERROR_EVENT,
  type TerminalClipboardErrorDetail,
} from '@/lib/terminalClipboardEvents'

describe('terminalClipboardEvents', () => {
  it('dispatches clipboard errors with optional terminal id', () => {
    const handler = vi.fn()
    window.addEventListener(TERMINAL_CLIPBOARD_ERROR_EVENT, handler as EventListener)
    reportTerminalClipboardError('复制失败: denied', 'term-1')
    const event = handler.mock.calls[0][0] as CustomEvent<TerminalClipboardErrorDetail>
    expect(event.detail).toEqual({ terminalID: 'term-1', message: '复制失败: denied' })
    window.removeEventListener(TERMINAL_CLIPBOARD_ERROR_EVENT, handler as EventListener)
  })
})
