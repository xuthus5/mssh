import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const terminalInstances: Array<{ focus: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> = []
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options = {}
    focus = vi.fn()
    blur = vi.fn()
    refresh = vi.fn()
    dispose = vi.fn()
    constructor() { terminalInstances.push(this) }
    open() {}
    loadAddon() {}
    onData() { return { dispose: vi.fn() } }
    write() {}
  },
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {}; dispose() {} } }))
vi.mock('@wailsio/runtime', () => ({ Events: { On: vi.fn(() => vi.fn()) } }))
vi.mock('@/lib/wails', () => ({
  TerminalService: {
    Open: vi.fn(async () => 'split-1'),
    Close: vi.fn(async () => {}),
    Resize: vi.fn(async () => {}),
    Write: vi.fn(async () => {}),
  },
}))

import { TerminalSplit } from '@/components/terminal/TerminalSplit'
import type { TerminalFocusRequest } from '@/hooks/useTerminal'
import { useAppStore } from '@/store/appStore'
import { TerminalService } from '@/lib/wails'
import { logger } from '@/lib/logger'

describe('TerminalSplit focus requests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    terminalInstances.length = 0
    useAppStore.setState({ activePaneId: 'split-1', terminalPool: new Map() })
    vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {} })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500)
  })

  it('does not transfer an old sequence when the active pane changes', async () => {
    const noRequest = { sequence: 0, targetTerminalID: null } as TerminalFocusRequest
    const view = render(<TerminalSplit primaryID="primary-1" sessionId={1} active focusRequest={noRequest} />)
    await waitFor(() => expect(terminalInstances).toHaveLength(2))
    terminalInstances.forEach((terminal) => terminal.focus.mockClear())

    const splitRequest = { sequence: 1, targetTerminalID: 'split-1' } as TerminalFocusRequest
    view.rerender(<TerminalSplit primaryID="primary-1" sessionId={1} active focusRequest={splitRequest} />)
    expect(terminalInstances[0].focus).not.toHaveBeenCalled()
    expect(terminalInstances[1].focus).toHaveBeenCalledOnce()

    act(() => useAppStore.setState({ activePaneId: 'primary-1' }))
    expect(terminalInstances[0].focus).not.toHaveBeenCalled()
    expect(terminalInstances[1].focus).toHaveBeenCalledOnce()
  })

  it('changes direction and closes the split terminal', async () => {
    const request = { sequence: 0, targetTerminalID: null } as TerminalFocusRequest
    render(<TerminalSplit primaryID="primary-1" sessionId={1} active focusRequest={request} />)
    await waitFor(() => expect(terminalInstances).toHaveLength(2))

    fireEvent.click(screen.getByTitle('垂直分屏'))
    fireEvent.click(screen.getByTitle('关闭分屏'))

    await waitFor(() => expect(TerminalService.Close).toHaveBeenCalledWith('split-1'))
    expect(screen.queryByTitle('关闭分屏')).not.toBeInTheDocument()
  })

  it('logs split open failures', async () => {
    const openError = new Error('open failed')
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => {})
    vi.mocked(TerminalService.Open).mockRejectedValueOnce(openError)
    const request = { sequence: 0, targetTerminalID: null } as TerminalFocusRequest

    render(<TerminalSplit primaryID="primary-1" sessionId={1} active focusRequest={request} />)

    await waitFor(() => expect(loggerError).toHaveBeenCalledWith('TerminalSplit: failed to open split', openError))
  })
})
