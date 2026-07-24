import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const transfer = vi.hoisted(() => ({
  files: [], currentPath: '/', loading: false, error: '', listFiles: vi.fn(async () => {}),
  loadDirectory: vi.fn(async () => []), navigateTo: vi.fn(), navigateUp: vi.fn(), deleteFile: vi.fn(),
  renameFile: vi.fn(), makeDir: vi.fn(), upload: vi.fn(async () => {}), uploadMany: vi.fn(async () => {}),
  download: vi.fn(async () => {}),
}))
const terminalService = vi.hoisted(() => ({ write: vi.fn(async (_terminalID: string, _data: string) => 0) }))
type DropHandler = (event: { data?: { files?: string[]; details?: { id?: string } } }) => void
const runtime = vi.hoisted(() => ({
  openFile: vi.fn(async (..._args: unknown[]) => ''),
  saveFile: vi.fn(async (..._args: unknown[]) => ''),
  onFilesDropped: vi.fn((_handler?: DropHandler) => vi.fn()),
}))
const notify = vi.hoisted(() => vi.fn((..._args: unknown[]) => undefined))

vi.mock('@wailsio/runtime', () => ({
  Dialogs: {
    OpenFile: (...args: unknown[]) => runtime.openFile(...args),
    SaveFile: (...args: unknown[]) => runtime.saveFile(...args),
  },
  Events: {
    On: (name: string, handler: DropHandler) => {
      if (name === 'sftp:files-dropped') return runtime.onFilesDropped(handler)
      return vi.fn()
    },
  },
}))
vi.mock('@/components/ui/toast', () => ({ toast: (...args: unknown[]) => notify(...args) }))
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
  default: ({ dropTargetId, showHiddenFiles, defaultView, actionError, onSyncCurrentDirectory, onUpload, onDownload }: {
    dropTargetId: string
    showHiddenFiles: boolean
    defaultView: string
    actionError?: string
    onSyncCurrentDirectory: () => void
    onUpload: () => void
    onDownload: (path: string) => void
  }) => (
    <div data-testid="file-panel" data-drop-target-id={dropTargetId} data-show-hidden={String(showHiddenFiles)} data-default-view={defaultView}>
      {actionError ? <div role="alert">{actionError}</div> : null}
      <button type="button" onClick={onSyncCurrentDirectory}>同步当前目录</button>
      <button type="button" onClick={onUpload}>upload</button>
      <button type="button" onClick={() => onDownload('/remote/app.log')}>download</button>
    </div>
  ),
}))
vi.mock('@/hooks/useFileTransfer', () => ({
  useFileTransfer: () => transfer,
}))
vi.mock('@/hooks/useSFTPSettings', () => ({ useSFTPSettings: vi.fn() }))
vi.mock('@/hooks/SessionWorkspaceContext', () => ({ useSessionWorkspace: () => ({ reconnect: vi.fn(async () => {}) }) }))
vi.mock('@/lib/wails', () => ({ TerminalService: { Write: terminalService.write } }))

import { TerminalLayers } from '@/components/terminal/TerminalLayers'
import { useAppStore } from '@/store/appStore'
import { useSFTPSettingsStore } from '@/store/sftpSettingsStore'
import { useTerminalDirectoryStore } from '@/store/terminalDirectoryStore'
import { MANUAL_TERMINAL_DIRECTORY_REPORT } from '@/hooks/terminalDirectoryRuntime'

describe('TerminalLayers SFTP isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    notify.mockReset()
    runtime.openFile.mockReset()
    runtime.saveFile.mockReset()
    runtime.onFilesDropped.mockReset()
    runtime.onFilesDropped.mockImplementation(() => vi.fn())
    useSFTPSettingsStore.setState({ showHiddenFiles: false, followTerminalDirectory: false, defaultView: 'list' })
    useTerminalDirectoryStore.setState({ directories: {}, revisions: {} })
    terminalService.write.mockImplementation(async (terminalID: string, _data: string) => {
      useTerminalDirectoryStore.getState().setDirectory(terminalID, '/manual-sync')
      return 0
    })
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
    useTerminalDirectoryStore.setState({ directories: { 'split-term-a': '/srv/app' }, revisions: { 'split-term-a': 1 } })
    render(<TerminalLayers />)
    const terminalA = (await screen.findByTestId('terminal-term-a')).closest('[data-layer-id="terminal-a"]') as HTMLElement

    fireEvent.click(within(terminalA).getByRole('button', { name: 'split files' }))

    await waitFor(() => expect(transfer.listFiles).toHaveBeenCalledWith('/srv/app'))
    expect(await within(terminalA).findByTestId('file-panel')).toHaveAttribute('data-show-hidden', 'true')
    expect(within(terminalA).getByTestId('file-panel')).toHaveAttribute('data-default-view', 'tree')
  })

  it('requests a manual OSC 7 report from the selected terminal', async () => {
    render(<TerminalLayers />)
    const terminalA = (await screen.findByTestId('terminal-term-a')).closest('[data-layer-id="terminal-a"]') as HTMLElement
    fireEvent.click(within(terminalA).getByRole('button', { name: 'files' }))

    await waitFor(() => expect(within(terminalA).getByRole('button', { name: '同步当前目录' })).toBeInTheDocument())
    fireEvent.click(within(terminalA).getByRole('button', { name: '同步当前目录' }))

    await waitFor(() => expect(terminalService.write).toHaveBeenCalledWith('term-a', MANUAL_TERMINAL_DIRECTORY_REPORT))
    await waitFor(() => expect(transfer.listFiles).toHaveBeenCalledWith('/manual-sync'))
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

  it('surfaces upload dialog failures without unhandled rejections', async () => {
    runtime.openFile.mockRejectedValue(new Error('picker unavailable'))
    render(<TerminalLayers />)
    const terminalA = (await screen.findByTestId('terminal-term-a')).closest('[data-layer-id="terminal-a"]') as HTMLElement
    fireEvent.click(within(terminalA).getByRole('button', { name: 'files' }))
    fireEvent.click(await within(terminalA).findByRole('button', { name: 'upload' }))
    expect(await within(terminalA).findByRole('alert')).toHaveTextContent('选择上传文件失败: picker unavailable')
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining('选择上传文件失败'), 'error')
    expect(transfer.upload).not.toHaveBeenCalled()
  })

  it('surfaces download dialog failures without unhandled rejections', async () => {
    runtime.saveFile.mockRejectedValue(new Error('save cancelled hard'))
    render(<TerminalLayers />)
    const terminalA = (await screen.findByTestId('terminal-term-a')).closest('[data-layer-id="terminal-a"]') as HTMLElement
    fireEvent.click(within(terminalA).getByRole('button', { name: 'files' }))
    fireEvent.click(await within(terminalA).findByRole('button', { name: 'download' }))
    expect(await within(terminalA).findByRole('alert')).toHaveTextContent('选择下载位置失败: save cancelled hard')
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining('选择下载位置失败'), 'error')
    expect(transfer.download).not.toHaveBeenCalled()
  })

  it('loads the initial directory without toast when listFiles fails', async () => {
    // Matches production listFiles: sets panel error and resolves without rejecting.
    transfer.listFiles.mockImplementationOnce(async () => {
      transfer.error = 'sftp offline'
    })
    render(<TerminalLayers />)
    const terminalA = (await screen.findByTestId('terminal-term-a')).closest('[data-layer-id="terminal-a"]') as HTMLElement
    fireEvent.click(within(terminalA).getByRole('button', { name: 'files' }))
    await waitFor(() => expect(transfer.listFiles).toHaveBeenCalled())
    expect(transfer.error).toBe('sftp offline')
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining('加载文件列表失败'), 'error')
  })

  it('forwards drop uploads without second-owner toast wrapping', async () => {
    let dropHandler: ((event: { data?: { files?: string[]; details?: { id?: string } } }) => void) | undefined
    runtime.onFilesDropped.mockImplementation((handler?: DropHandler) => {
      dropHandler = handler
      return vi.fn()
    })
    // Production uploadMany toasts internally and resolves; layers must not wrap again.
    transfer.uploadMany.mockImplementationOnce(async () => {
      notify('上传失败: drop denied', 'error')
    })
    render(<TerminalLayers />)
    const terminalA = (await screen.findByTestId('terminal-term-a')).closest('[data-layer-id="terminal-a"]') as HTMLElement
    fireEvent.click(within(terminalA).getByRole('button', { name: 'files' }))
    await within(terminalA).findByTestId('file-panel')
    expect(dropHandler).toBeTypeOf('function')
    dropHandler?.({ data: { files: ['/tmp/a.txt'], details: { id: 'sftp-drop-zone-term-a' } } })
    await waitFor(() => expect(transfer.uploadMany).toHaveBeenCalledWith(['/tmp/a.txt'], '/'))
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('上传失败: drop denied', 'error')
  })
})
