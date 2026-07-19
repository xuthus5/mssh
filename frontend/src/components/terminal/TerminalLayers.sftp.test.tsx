import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const transfer = vi.hoisted(() => ({
  files: [], currentPath: '/', loading: false, error: '', listFiles: vi.fn(async () => {}),
  loadDirectory: vi.fn(async () => []), navigateTo: vi.fn(), navigateUp: vi.fn(), deleteFile: vi.fn(),
  renameFile: vi.fn(), makeDir: vi.fn(), upload: vi.fn(async () => {}), uploadMany: vi.fn(async () => {}),
  download: vi.fn(async () => {}),
}))

vi.mock('@/components/terminal/TerminalTab', () => ({
  TerminalTab: ({ terminalID, onOpenFiles, onPaneClosed, onPaneReplaced }: {
    terminalID: string
    onOpenFiles: (terminalID: string) => void
    onPaneClosed: (terminalID: string) => void
    onPaneReplaced: (previousID: string, nextID: string) => void
  }) => (
    <div data-testid={`terminal-${terminalID}`}>
      <button type="button" onClick={() => onOpenFiles(terminalID)}>files</button>
      <button type="button" onClick={() => onOpenFiles(`split-${terminalID}`)}>split files</button>
      <button type="button" onClick={() => onPaneClosed(`split-${terminalID}`)}>close split</button>
      <button type="button" onClick={() => onPaneReplaced(`split-${terminalID}`, `replacement-${terminalID}`)}>reconnect split</button>
    </div>
  ),
}))
vi.mock('@/components/terminal/PlaybackTab', () => ({ PlaybackTab: () => null }))
vi.mock('@/components/file/FilePanel', () => ({
  default: ({ dropTargetId, showHiddenFiles, defaultView }: { dropTargetId: string; showHiddenFiles: boolean; defaultView: string }) => (
    <div data-testid="file-panel" data-drop-target-id={dropTargetId} data-show-hidden={String(showHiddenFiles)} data-default-view={defaultView} />
  ),
}))
vi.mock('@/hooks/useFileTransfer', () => ({
  useFileTransfer: () => transfer,
}))
vi.mock('@/hooks/useSFTPSettings', () => ({ useSFTPSettings: vi.fn() }))
vi.mock('@/hooks/SessionWorkspaceContext', () => ({ useSessionWorkspace: () => ({ reconnect: vi.fn(async () => {}) }) }))

import { TerminalLayers } from '@/components/terminal/TerminalLayers'
import { useAppStore } from '@/store/appStore'
import { useSFTPSettingsStore } from '@/store/sftpSettingsStore'
import { useTerminalDirectoryStore } from '@/store/terminalDirectoryStore'

describe('TerminalLayers SFTP isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSFTPSettingsStore.setState({ showHiddenFiles: false, followTerminalDirectory: false, defaultView: 'list' })
    useTerminalDirectoryStore.setState({ directories: {} })
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

  it('follows the selected terminal directory and applies view settings', async () => {
    useSFTPSettingsStore.setState({ showHiddenFiles: true, followTerminalDirectory: true, defaultView: 'tree' })
    useTerminalDirectoryStore.setState({ directories: { 'split-term-a': '/srv/app' } })
    render(<TerminalLayers />)
    const terminalA = (await screen.findByTestId('terminal-term-a')).closest('[data-layer-id="terminal-a"]') as HTMLElement

    fireEvent.click(within(terminalA).getByRole('button', { name: 'split files' }))

    await waitFor(() => expect(transfer.listFiles).toHaveBeenCalledWith('/srv/app'))
    expect(await within(terminalA).findByTestId('file-panel')).toHaveAttribute('data-show-hidden', 'true')
    expect(within(terminalA).getByTestId('file-panel')).toHaveAttribute('data-default-view', 'tree')
  })

  it('retains independent panels and drop targets for terminals from the same session', async () => {
    const store = useAppStore.getState()
    render(<TerminalLayers />)
    const terminalA = (await screen.findByTestId('terminal-term-a')).closest('[data-layer-id="terminal-a"]') as HTMLElement
    const terminalB = screen.getByTestId('terminal-term-b').closest('[data-layer-id="terminal-b"]') as HTMLElement

    fireEvent.click(within(terminalA).getByRole('button', { name: 'files' }))
    expect(await within(terminalA).findByTestId('file-panel')).toHaveAttribute('data-drop-target-id', 'sftp-drop-zone-term-a')
    fireEvent.click(within(terminalA).getByRole('button', { name: 'split files' }))
    expect(await within(terminalA).findByTestId('file-panel')).toHaveAttribute('data-drop-target-id', 'sftp-drop-zone-split-term-a')
    fireEvent.click(within(terminalA).getByRole('button', { name: 'reconnect split' }))
    expect(await within(terminalA).findByTestId('file-panel')).toHaveAttribute('data-drop-target-id', 'sftp-drop-zone-replacement-term-a')
    fireEvent.click(within(terminalA).getByRole('button', { name: 'split files' }))
    fireEvent.click(within(terminalA).getByRole('button', { name: 'close split' }))
    expect(within(terminalA).queryByTestId('file-panel')).not.toBeInTheDocument()

    fireEvent.click(within(terminalA).getByRole('button', { name: 'files' }))

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
