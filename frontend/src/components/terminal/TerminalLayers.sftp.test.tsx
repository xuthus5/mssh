import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const transfer = vi.hoisted(() => ({
  files: [], currentPath: '/', loading: false, error: '', listFiles: vi.fn(async () => {}),
  loadDirectory: vi.fn(async () => []), navigateTo: vi.fn(), navigateUp: vi.fn(), deleteFile: vi.fn(),
  renameFile: vi.fn(), makeDir: vi.fn(), upload: vi.fn(async () => {}), uploadMany: vi.fn(async () => {}),
  download: vi.fn(async () => {}),
}))
const terminalService = vi.hoisted(() => ({ write: vi.fn(async (_terminalID: string, _data: string) => 0) }))
const fileService = vi.hoisted(() => ({
  installTerminalDirectoryIntegration: vi.fn(async (_sessionID: number) => ['/home/test/.bashrc', '/home/test/.zshrc']),
}))
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
  default: ({ dropTargetId, showHiddenFiles, defaultView, actionError, transferActionPending, onSyncCurrentDirectory, onInstallDirectoryIntegration, onUpload, onDownload }: {
    dropTargetId: string
    showHiddenFiles: boolean
    defaultView: string
    actionError?: string
    transferActionPending?: 'upload' | 'download' | null
    onSyncCurrentDirectory: () => void
    onInstallDirectoryIntegration: () => void
    onUpload: () => void
    onDownload: (path: string) => void
  }) => (
    <div data-testid="file-panel" data-drop-target-id={dropTargetId} data-show-hidden={String(showHiddenFiles)} data-default-view={defaultView}>
      {actionError ? <div role="alert">{actionError}</div> : null}
      <button type="button" onClick={onSyncCurrentDirectory}>同步当前目录</button>
      <button type="button" onClick={onInstallDirectoryIntegration}>安装自动跟随脚本</button>
      <button type="button" disabled={transferActionPending !== null && transferActionPending !== undefined} onClick={onUpload}>upload</button>
      <button type="button" disabled={transferActionPending !== null && transferActionPending !== undefined} onClick={() => onDownload('/remote/app.log')}>download</button>
    </div>
  ),
}))
vi.mock('@/hooks/useFileTransfer', () => ({
  useFileTransfer: () => transfer,
}))
vi.mock('@/hooks/useSFTPSettings', () => ({ useSFTPSettings: vi.fn() }))
vi.mock('@/hooks/SessionWorkspaceContext', () => ({ useSessionWorkspace: () => ({ reconnect: vi.fn(async () => {}) }) }))
vi.mock('@/lib/wails', () => ({
  FileService: { InstallTerminalDirectoryIntegration: fileService.installTerminalDirectoryIntegration },
  TerminalService: { Write: terminalService.write },
}))

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
    fileService.installTerminalDirectoryIntegration.mockReset()
    fileService.installTerminalDirectoryIntegration.mockResolvedValue(['/home/test/.bashrc', '/home/test/.zshrc'])
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

  it('installs OSC 7 shell integration for the selected session', async () => {
    render(<TerminalLayers />)
    const terminalA = (await screen.findByTestId('terminal-term-a')).closest('[data-layer-id="terminal-a"]') as HTMLElement
    fireEvent.click(within(terminalA).getByRole('button', { name: 'files' }))

    fireEvent.click(await within(terminalA).findByRole('button', { name: '安装自动跟随脚本' }))

    await waitFor(() => expect(fileService.installTerminalDirectoryIntegration).toHaveBeenCalledWith(1))
    expect(notify).toHaveBeenCalledWith('已安装自动跟随脚本: /home/test/.bashrc, /home/test/.zshrc', 'success')
  })

  it('surfaces OSC 7 shell integration installation failures on the file panel', async () => {
    fileService.installTerminalDirectoryIntegration.mockRejectedValueOnce(new Error('permission denied'))
    render(<TerminalLayers />)
    const terminalA = (await screen.findByTestId('terminal-term-a')).closest('[data-layer-id="terminal-a"]') as HTMLElement
    fireEvent.click(within(terminalA).getByRole('button', { name: 'files' }))

    fireEvent.click(await within(terminalA).findByRole('button', { name: '安装自动跟随脚本' }))

    expect(await within(terminalA).findByRole('alert')).toHaveTextContent('安装自动跟随脚本失败: permission denied')
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining('安装自动跟随脚本失败'), 'error')
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

  it('surfaces transfer upload start failures on the file panel without toast', async () => {
    transfer.upload.mockRejectedValueOnce(new Error('upload denied'))
    runtime.openFile.mockResolvedValue('/tmp/a.txt')
    render(<TerminalLayers />)
    const terminalA = (await screen.findByTestId('terminal-term-a')).closest('[data-layer-id="terminal-a"]') as HTMLElement
    fireEvent.click(within(terminalA).getByRole('button', { name: 'files' }))
    fireEvent.click(await within(terminalA).findByRole('button', { name: 'upload' }))
    expect(await within(terminalA).findByRole('alert')).toHaveTextContent('上传失败: upload denied')
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining('上传失败'), 'error')
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

  it('keeps upload and download native pickers single-flight', async () => {
    const picker = deferred<string>()
    runtime.openFile.mockReturnValueOnce(picker.promise)
    render(<TerminalLayers />)
    const terminalA = (await screen.findByTestId('terminal-term-a')).closest('[data-layer-id="terminal-a"]') as HTMLElement
    fireEvent.click(within(terminalA).getByRole('button', { name: 'files' }))
    const upload = await within(terminalA).findByRole('button', { name: 'upload' })
    const download = within(terminalA).getByRole('button', { name: 'download' })

    act(() => {
      fireEvent.click(upload)
      fireEvent.click(upload)
      fireEvent.click(download)
    })

    expect(runtime.openFile).toHaveBeenCalledOnce()
    expect(runtime.saveFile).not.toHaveBeenCalled()
    expect(upload).toBeDisabled()
    expect(download).toBeDisabled()
    await act(async () => { picker.resolve('/tmp/current.txt'); await Promise.resolve() })
    expect(transfer.upload).toHaveBeenCalledWith('/tmp/current.txt', '/')
  })

  it('retains the native picker lease when the selected terminal changes', async () => {
    const firstPicker = deferred<string>()
    runtime.openFile.mockReturnValueOnce(firstPicker.promise)
    runtime.saveFile.mockResolvedValueOnce('/tmp/fresh.log')
    render(<TerminalLayers />)
    const terminalA = (await screen.findByTestId('terminal-term-a')).closest('[data-layer-id="terminal-a"]') as HTMLElement
    fireEvent.click(within(terminalA).getByRole('button', { name: 'files' }))
    fireEvent.click(await within(terminalA).findByRole('button', { name: 'upload' }))

    fireEvent.click(within(terminalA).getByRole('button', { name: 'split files' }))
    const upload = await within(terminalA).findByRole('button', { name: 'upload' })
    const download = within(terminalA).getByRole('button', { name: 'download' })
    expect(upload).toBeDisabled()
    expect(download).toBeDisabled()
    fireEvent.click(upload)
    fireEvent.click(download)
    expect(runtime.openFile).toHaveBeenCalledOnce()
    expect(runtime.saveFile).not.toHaveBeenCalled()

    await act(async () => { firstPicker.resolve('/tmp/stale.txt'); await Promise.resolve() })
    expect(transfer.upload).not.toHaveBeenCalled()
    await waitFor(() => expect(download).toBeEnabled())
    fireEvent.click(download)
    await waitFor(() => expect(runtime.saveFile).toHaveBeenCalledOnce())
    expect(transfer.download).toHaveBeenCalledWith('/remote/app.log', '/tmp/fresh.log')
  })

  it('ignores an upload picker after the file panel closes and allows a fresh picker after reopen', async () => {
    const firstPicker = deferred<string>()
    runtime.openFile.mockReturnValueOnce(firstPicker.promise).mockResolvedValueOnce('/tmp/fresh.txt')
    render(<TerminalLayers />)
    const terminalA = (await screen.findByTestId('terminal-term-a')).closest('[data-layer-id="terminal-a"]') as HTMLElement
    const filesButton = within(terminalA).getByRole('button', { name: 'files' })
    fireEvent.click(filesButton)
    fireEvent.click(await within(terminalA).findByRole('button', { name: 'upload' }))
    fireEvent.click(filesButton)

    await act(async () => { firstPicker.resolve('/tmp/stale.txt'); await Promise.resolve() })
    expect(transfer.upload).not.toHaveBeenCalled()

    fireEvent.click(filesButton)
    fireEvent.click(await within(terminalA).findByRole('button', { name: 'upload' }))
    await waitFor(() => expect(transfer.upload).toHaveBeenCalledWith('/tmp/fresh.txt', '/'))
    expect(runtime.openFile).toHaveBeenCalledTimes(2)
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

  it('surfaces drop upload failures on the file panel without toast', async () => {
    let dropHandler: ((event: { data?: { files?: string[]; details?: { id?: string } } }) => void) | undefined
    runtime.onFilesDropped.mockImplementation((handler?: DropHandler) => {
      dropHandler = handler
      return vi.fn()
    })
    transfer.uploadMany.mockRejectedValueOnce(new Error('drop denied'))
    render(<TerminalLayers />)
    const terminalA = (await screen.findByTestId('terminal-term-a')).closest('[data-layer-id="terminal-a"]') as HTMLElement
    fireEvent.click(within(terminalA).getByRole('button', { name: 'files' }))
    await within(terminalA).findByTestId('file-panel')
    expect(dropHandler).toBeTypeOf('function')
    dropHandler?.({ data: { files: ['/tmp/a.txt'], details: { id: 'sftp-drop-zone-term-a' } } })
    await waitFor(() => expect(transfer.uploadMany).toHaveBeenCalledWith(['/tmp/a.txt'], '/'))
    expect(await within(terminalA).findByRole('alert')).toHaveTextContent('上传失败: drop denied')
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining('上传失败'), 'error')
  })

  it('rejects oversized dropped batches before starting partial uploads', async () => {
    let dropHandler: DropHandler | undefined
    runtime.onFilesDropped.mockImplementation((handler?: DropHandler) => {
      dropHandler = handler
      return vi.fn()
    })
    render(<TerminalLayers />)
    const terminalA = (await screen.findByTestId('terminal-term-a')).closest('[data-layer-id="terminal-a"]') as HTMLElement
    fireEvent.click(within(terminalA).getByRole('button', { name: 'files' }))
    await within(terminalA).findByTestId('file-panel')

    dropHandler?.({ data: {
      files: Array.from({ length: 33 }, (_, index) => `/tmp/file-${index}.txt`),
      details: { id: 'sftp-drop-zone-term-a' },
    } })

    expect(transfer.uploadMany).not.toHaveBeenCalled()
    expect(await within(terminalA).findByRole('alert')).toHaveTextContent('单次最多拖拽 32 个文件')
  })

  it('keeps dropped upload batches single-flight per file panel', async () => {
    let dropHandler: DropHandler | undefined
    const activeBatch = deferred<void>()
    runtime.onFilesDropped.mockImplementation((handler?: DropHandler) => {
      dropHandler = handler
      return vi.fn()
    })
    transfer.uploadMany.mockReturnValueOnce(activeBatch.promise)
    render(<TerminalLayers />)
    const terminalA = (await screen.findByTestId('terminal-term-a')).closest('[data-layer-id="terminal-a"]') as HTMLElement
    fireEvent.click(within(terminalA).getByRole('button', { name: 'files' }))
    await within(terminalA).findByTestId('file-panel')

    dropHandler?.({ data: { files: ['/tmp/first.txt'], details: { id: 'sftp-drop-zone-term-a' } } })
    await waitFor(() => expect(transfer.uploadMany).toHaveBeenCalledOnce())
    dropHandler?.({ data: { files: ['/tmp/second.txt'], details: { id: 'sftp-drop-zone-term-a' } } })

    expect(transfer.uploadMany).toHaveBeenCalledOnce()
    expect(await within(terminalA).findByRole('alert')).toHaveTextContent('上传队列正在处理，请稍后重试')
    await act(async () => { activeBatch.resolve(); await activeBatch.promise })
  })

  it('does not report sync success after the SFTP panel is closed', async () => {
    const writing = deferred<number>()
    terminalService.write.mockImplementationOnce(async (terminalID: string) => {
      await writing.promise
      useTerminalDirectoryStore.getState().setDirectory(terminalID, '/manual-sync')
      return 0
    })
    render(<TerminalLayers />)
    const terminalA = (await screen.findByTestId('terminal-term-a')).closest('[data-layer-id="terminal-a"]') as HTMLElement
    fireEvent.click(within(terminalA).getByRole('button', { name: 'files' }))
    fireEvent.click(await within(terminalA).findByRole('button', { name: '同步当前目录' }))
    await waitFor(() => expect(terminalService.write).toHaveBeenCalled())
    act(() => useAppStore.setState({ tabs: [{ id: 'terminal-a', title: 'Terminal', type: 'terminal', terminalId: 'term-a', sessionId: 1 }] }))
    writing.resolve(0)
    await act(async () => { await Promise.resolve() })
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining('已同步当前目录'), 'success')
  })

  it('does not let a stale directory sync release the current terminal lease', async () => {
    const firstWrite = deferred<number>()
    const secondWrite = deferred<number>()
    terminalService.write
      .mockImplementationOnce(async (terminalID: string) => {
        await firstWrite.promise
        useTerminalDirectoryStore.getState().setDirectory(terminalID, '/first-sync')
        return 0
      })
      .mockImplementationOnce(async (terminalID: string) => {
        await secondWrite.promise
        useTerminalDirectoryStore.getState().setDirectory(terminalID, '/second-sync')
        return 0
      })
    render(<TerminalLayers />)
    const terminalA = (await screen.findByTestId('terminal-term-a')).closest('[data-layer-id="terminal-a"]') as HTMLElement
    fireEvent.click(within(terminalA).getByRole('button', { name: 'files' }))
    fireEvent.click(await within(terminalA).findByRole('button', { name: '同步当前目录' }))
    await waitFor(() => expect(terminalService.write).toHaveBeenCalledWith('term-a', MANUAL_TERMINAL_DIRECTORY_REPORT))

    fireEvent.click(within(terminalA).getByRole('button', { name: 'split files' }))
    await waitFor(() => expect(within(terminalA).getByTestId('file-panel')).toHaveAttribute('data-drop-target-id', 'sftp-drop-zone-split-term-a'))
    fireEvent.click(within(terminalA).getByRole('button', { name: '同步当前目录' }))
    await waitFor(() => expect(terminalService.write).toHaveBeenCalledTimes(2))

    await act(async () => { firstWrite.resolve(0); await Promise.resolve() })
    fireEvent.click(within(terminalA).getByRole('button', { name: '同步当前目录' }))
    expect(terminalService.write).toHaveBeenCalledTimes(2)

    await act(async () => { secondWrite.resolve(0); await Promise.resolve() })
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
