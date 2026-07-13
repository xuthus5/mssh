import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/terminal/TerminalTab', () => ({
  TerminalTab: ({ focusRequest }: { focusRequest: { sequence: number; targetTerminalID?: string | null } }) => (
    <div data-testid="focus-request">{focusRequest.sequence}:{focusRequest.targetTerminalID ?? 'none'}</div>
  ),
}))
vi.mock('@/components/terminal/PlaybackTab', () => ({ PlaybackTab: () => null }))
vi.mock('@/components/file/FilePanel', () => ({ default: () => null }))
vi.mock('@/hooks/useFileTransfer', () => ({ useFileTransfer: vi.fn() }))

import { TerminalLayers } from '@/components/terminal/TerminalLayers'
import { useAppStore } from '@/store/appStore'

describe('TerminalLayers focus targeting', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [{ id: 'tab-1', title: 'Terminal', type: 'terminal', terminalId: 'primary-1', sessionId: 1 }],
      activeSurface: { type: 'terminal', id: 'tab-1' },
      activePaneId: 'split-1',
      focusRequest: { id: '', sequence: 0 },
    })
  })

  it('freezes one pane target for each tab focus sequence', async () => {
    render(<TerminalLayers />)
    act(() => useAppStore.setState({ focusRequest: { id: 'tab-1', sequence: 1 } }))
    await waitFor(() => expect(screen.getByTestId('focus-request')).toHaveTextContent('1:split-1'))

    act(() => useAppStore.setState({ activePaneId: 'primary-1' }))
    expect(screen.getByTestId('focus-request')).toHaveTextContent('1:split-1')

    act(() => useAppStore.setState({ focusRequest: { id: 'tab-1', sequence: 2 } }))
    await waitFor(() => expect(screen.getByTestId('focus-request')).toHaveTextContent('2:primary-1'))
  })
})
