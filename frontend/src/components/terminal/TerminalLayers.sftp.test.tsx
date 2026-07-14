import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/terminal/TerminalTab', () => ({
  TerminalTab: ({ terminalID, onOpenFiles }: { terminalID: string; onOpenFiles: () => void }) => (
    <div data-testid={`terminal-${terminalID}`}>
      <button type="button" onClick={onOpenFiles}>files</button>
    </div>
  ),
}))
vi.mock('@/components/terminal/PlaybackTab', () => ({ PlaybackTab: () => null }))
vi.mock('@/components/file/FilePanel', () => ({
  default: ({ dropTargetId }: { dropTargetId: string }) => (
    <div data-testid="file-panel" data-drop-target-id={dropTargetId} />
  ),
}))
vi.mock('@/hooks/useFileTransfer', () => ({
  useFileTransfer: () => ({
    files: [],
    currentPath: '/',
    loading: false,
    error: '',
    listFiles: vi.fn(async () => {}),
    navigateTo: vi.fn(),
    navigateUp: vi.fn(),
    deleteFile: vi.fn(),
    renameFile: vi.fn(),
    makeDir: vi.fn(),
    upload: vi.fn(async () => {}),
    uploadMany: vi.fn(async () => {}),
    download: vi.fn(async () => {}),
  }),
}))
vi.mock('@/hooks/SessionWorkspaceContext', () => ({ useSessionWorkspace: () => ({ reconnect: vi.fn(async () => {}) }) }))

import { TerminalLayers } from '@/components/terminal/TerminalLayers'
import { useAppStore } from '@/store/appStore'

describe('TerminalLayers SFTP isolation', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [
        { id: 'terminal-a', title: 'Terminal', type: 'terminal', terminalId: 'term-a', sessionId: 1 },
        { id: 'terminal-b', title: 'Terminal #2', type: 'terminal', terminalId: 'term-b', sessionId: 1 },
      ],
      activeSurface: { type: 'terminal', id: 'terminal-a' },
      focusRequest: { id: '', terminalId: null, sequence: 0 },
      activePaneId: null,
      connectionStatus: {},
      recordingState: {},
    })
  })

  it('retains independent panels and drop targets for terminals from the same session', async () => {
    const store = useAppStore.getState()
    render(<TerminalLayers />)
    const terminalA = (await screen.findByTestId('terminal-term-a')).closest('[data-layer-id="terminal-a"]') as HTMLElement
    const terminalB = screen.getByTestId('terminal-term-b').closest('[data-layer-id="terminal-b"]') as HTMLElement

    fireEvent.click(within(terminalA).getByRole('button', { name: 'files' }))
    expect(await within(terminalA).findByTestId('file-panel')).toHaveAttribute('data-drop-target-id', 'sftp-drop-zone-term-a')

    act(() => store.activateTab('terminal-b'))
    expect(within(terminalB).queryByTestId('file-panel')).not.toBeInTheDocument()
    expect(within(terminalA).getByTestId('file-panel')).toBeInTheDocument()
    fireEvent.click(within(terminalB).getByRole('button', { name: 'files' }))
    expect(await within(terminalB).findByTestId('file-panel')).toHaveAttribute('data-drop-target-id', 'sftp-drop-zone-term-b')

    act(() => store.activateTab('terminal-a'))
    expect(within(terminalA).getByTestId('file-panel')).toBeInTheDocument()
    expect(within(terminalB).getByTestId('file-panel')).toBeInTheDocument()
  })
})
