import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const runtime = vi.hoisted(() => ({
  openFile: vi.fn(async () => '/tmp/upload.txt' as string | string[]),
  saveFile: vi.fn(async () => '/tmp/download.txt' as string | null),
  on: vi.fn(),
  dropped: undefined as undefined | ((event: { data?: { files?: string[]; details?: { id?: string } } }) => void),
}))
const transfer = vi.hoisted(() => ({
  listFiles: vi.fn(async () => {}), uploadMany: vi.fn(async () => {}), upload: vi.fn(async () => {}),
  download: vi.fn(async () => {}), navigateTo: vi.fn(), navigateUp: vi.fn(), deleteFile: vi.fn(),
  renameFile: vi.fn(), makeDir: vi.fn(),
}))
const layerLifecycle = vi.hoisted(() => ({
  nextInstance: 0,
  terminalCleanup: vi.fn(),
  playbackCleanup: vi.fn(),
}))
vi.mock('@wailsio/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wailsio/runtime')>()
  return {
    ...actual,
    Dialogs: { ...actual.Dialogs, OpenFile: runtime.openFile, SaveFile: runtime.saveFile },
    Events: { ...actual.Events, On: runtime.on },
  }
})
vi.mock('@/components/session/SessionAssetCenter', () => ({ SessionAssetCenter: () => <div>会话资产工作区</div> }))
vi.mock('@/components/layout/Sidebar', () => ({ default: () => null }))
vi.mock('@/components/layout/StatusBar', () => ({ default: () => null }))
vi.mock('@/components/layout/WindowTitleBar', () => ({ WindowTitleBar: () => null }))
vi.mock('@/components/layout/ConnectDialog', () => ({ ConnectDialog: () => null }))
vi.mock('@/components/session/SessionQuickSearchHost', () => ({ SessionQuickSearchHost: () => null }))
vi.mock('@/hooks/SessionWorkspaceContext', () => ({
  SessionWorkspaceProvider: ({ children }: { children: React.ReactNode }) => children,
  useSessionWorkspace: () => ({ reconnect: vi.fn(async () => {}) }),
}))
vi.mock('@/components/terminal/TerminalTab', async () => {
  const { useEffect, useRef, useState } = await import('react')
  return {
    TerminalTab: ({ terminalID, active, focusRequest, onOpenFiles }: {
      terminalID: string
      active: boolean
      focusRequest: { sequence: number }
      onOpenFiles: () => void
    }) => {
      const [instance] = useState(() => `terminal-instance-${++layerLifecycle.nextInstance}`)
      const handledSequence = useRef(0)
      useEffect(() => () => layerLifecycle.terminalCleanup(terminalID, instance), [instance, terminalID])
      useEffect(() => {
        if (!active || focusRequest.sequence <= handledSequence.current) return
        const state = useAppStore.getState()
        const targetID = state.activePaneId ?? terminalID
        state.terminalPool.get(targetID)?.terminal.focus()
        handledSequence.current = focusRequest.sequence
      }, [active, focusRequest.sequence, terminalID])
      return <div data-testid={`terminal-${terminalID}`} data-active={String(active)} data-instance={instance}>
        terminal<button type="button" onClick={onOpenFiles}>files</button>
      </div>
    },
  }
})
vi.mock('@/components/terminal/PlaybackTab', async () => {
  const { useEffect, useState } = await import('react')
  return {
    PlaybackTab: ({ recordingId }: { recordingId: string }) => {
      const [instance] = useState(() => `playback-instance-${++layerLifecycle.nextInstance}`)
      useEffect(() => () => layerLifecycle.playbackCleanup(recordingId, instance), [instance, recordingId])
      return <div data-testid={`playback-${recordingId}`} data-instance={instance}>playback</div>
    },
  }
})
vi.mock('@/components/file/FilePanel', () => ({
  default: ({ onUpload, onDownload, onClose, dropTargetId }: { onUpload: () => void; onDownload: (path: string) => void; onClose: () => void; dropTargetId: string }) => (
    <div data-testid="file-panel" data-drop-target-id={dropTargetId}>
      files panel
      <button type="button" onClick={onUpload}>upload file</button>
      <button type="button" onClick={() => onDownload('/remote/file.txt')}>download file</button>
      <button type="button" onClick={onClose}>close files</button>
    </div>
  ),
}))
vi.mock('@/hooks/useFileTransfer', () => ({
  useFileTransfer: () => ({
    files: [], currentPath: '/', loading: false, error: '', transfers: [], ...transfer,
  }),
}))

import App from '@/App'
import { logger } from '@/lib/logger'
import { useAppStore } from '@/store/appStore'
import { useToastStore } from '@/components/ui/toast'
afterEach(() => {
  cleanup()
  useToastStore.setState({ toasts: [] })
  vi.restoreAllMocks()
})

describe('persistent content layers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    layerLifecycle.nextInstance = 0
    runtime.dropped = undefined
    runtime.openFile.mockResolvedValue('/tmp/upload.txt')
    runtime.saveFile.mockResolvedValue('/tmp/download.txt')
    runtime.on.mockImplementation((name: string, callback: typeof runtime.dropped) => {
      if (name === 'sftp:files-dropped') runtime.dropped = callback
      return () => {}
    })
    useAppStore.setState({
      tabs: [],
      activeSurface: null,
      workspaceTab: 'sessions',
      terminalPool: new Map(),
      connectionStatus: {},
      recordingState: {},
      focusRequest: { id: '', sequence: 0 },
      activePaneId: null,
    })
  })

  it('leaves the welcome surface when a workspace is selected', () => {
    render(<App />)
    expect(screen.getByText('Secure Shell Client & Session Manager')).toBeInTheDocument()
    expect(screen.getByText('快捷键').parentElement).toHaveClass('rounded-xl')
    act(() => useAppStore.getState().activateWorkspace('sessions'))
    expect(useAppStore.getState().activeSurface).toEqual({ type: 'workspace', id: 'sessions' })
    expect(screen.getByText('Secure Shell Client & Session Manager')).toBeInTheDocument()
    act(() => useAppStore.getState().activateWorkspace('macros'))
    expect(useAppStore.getState().activeSurface).toEqual({ type: 'workspace', id: 'sessions' })
    expect(useAppStore.getState().workspaceTab).toBe('macros')
    expect(screen.queryByText('Secure Shell Client & Session Manager')).not.toBeInTheDocument()
  })

  it('keeps terminal and playback layers mounted behind the workspace', async () => {
    useAppStore.getState().openTab({ id: 'terminal-1', title: 'Terminal', type: 'terminal', terminalId: 'term-1', sessionId: 1 })
    useAppStore.getState().openTab({ id: 'playback-1', title: 'Playback', type: 'playback', recordingPath: 'recording-1' })
    const view = render(<App />)

    act(() => useAppStore.getState().activateTab('terminal-1'))
    expect(await screen.findByTestId('terminal-term-1')).toHaveAttribute('data-active', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'files' }))
    expect(await screen.findByTestId('file-panel')).toBeInTheDocument()
    expect(transfer.listFiles).toHaveBeenCalledWith('/')
    act(() => runtime.dropped?.({ data: { files: ['/tmp/drop.txt'], details: { id: 'sftp-drop-zone-term-1' } } }))
    expect(transfer.uploadMany).toHaveBeenCalledWith(['/tmp/drop.txt'], '/')
    fireEvent.click(screen.getByRole('button', { name: 'upload file' }))
    await waitFor(() => expect(transfer.upload).toHaveBeenCalledWith('/tmp/upload.txt', '/'))
    fireEvent.click(screen.getByRole('button', { name: 'download file' }))
    await waitFor(() => expect(transfer.download).toHaveBeenCalledWith('/remote/file.txt', '/tmp/download.txt'))
    fireEvent.click(screen.getByRole('button', { name: 'close files' }))
    expect(screen.queryByTestId('file-panel')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'files' }))
    expect(await screen.findByTestId('file-panel')).toBeInTheDocument()

    act(() => useAppStore.getState().activateWorkspace('sessions'))
    view.rerender(<App />)
    expect(screen.getByText('Secure Shell Client & Session Manager')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-term-1')).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('playback-recording-1')).toBeInTheDocument()
    const terminalLayer = screen.getByTestId('terminal-term-1').closest('[data-layer-id="terminal-1"]') as HTMLElement
    expect(terminalLayer).toHaveClass('visible')
    expect(within(terminalLayer).getByTestId('file-panel')).toBeInTheDocument()
  })

  it('preserves layer instances until their tabs are removed', async () => {
    const store = useAppStore.getState()
    store.openTab({ id: 'terminal-1', title: 'Terminal', type: 'terminal', terminalId: 'term-1', sessionId: 1 })
    store.openTab({ id: 'playback-1', title: 'Playback', type: 'playback', recordingPath: 'recording-1' })
    render(<App />)
    const terminal = await screen.findByTestId('terminal-term-1')
    const playback = await screen.findByTestId('playback-recording-1')
    const terminalInstance = terminal.getAttribute('data-instance')
    const playbackInstance = playback.getAttribute('data-instance')

    act(() => store.activateWorkspace('sessions'))
    act(() => store.activateWorkspace('macros'))
    act(() => store.activateTab('playback-1'))
    act(() => store.activateTab('terminal-1'))
    expect(screen.getByTestId('terminal-term-1')).toHaveAttribute('data-instance', terminalInstance)
    expect(screen.getByTestId('playback-recording-1')).toHaveAttribute('data-instance', playbackInstance)
    expect(layerLifecycle.terminalCleanup).not.toHaveBeenCalled()
    expect(layerLifecycle.playbackCleanup).not.toHaveBeenCalled()
    act(() => store.removeTabLocal('terminal-1'))
    expect(layerLifecycle.terminalCleanup).toHaveBeenCalledOnce()
    expect(layerLifecycle.playbackCleanup).not.toHaveBeenCalled()
    expect(screen.getByTestId('playback-recording-1')).toHaveAttribute('data-instance', playbackInstance)
    act(() => store.removeTabLocal('playback-1'))
    expect(layerLifecycle.playbackCleanup).toHaveBeenCalledOnce()
  })

  it('consumes each terminal focus request sequence once', async () => {
    const primaryFocus = vi.fn()
    const splitFocus = vi.fn()
    useAppStore.getState().openTab({ id: 'terminal-1', title: 'Terminal', type: 'terminal', terminalId: 'term-1', sessionId: 1 })
    useAppStore.setState({ terminalPool: new Map([['term-1', { terminal: { focus: primaryFocus } as never, lastUsed: 0 }]]) })
    render(<App />)
    await screen.findByTestId('terminal-term-1')
    act(() => useAppStore.getState().activateTab('terminal-1', true))
    expect(primaryFocus).toHaveBeenCalledOnce()

    act(() => useAppStore.setState((state) => ({ terminalPool: new Map(state.terminalPool) })))
    act(() => useAppStore.setState((state) => ({ tabs: [...state.tabs] })))
    act(() => useAppStore.setState({
      activePaneId: 'split-1',
      terminalPool: new Map([
        ['term-1', { terminal: { focus: primaryFocus } as never, lastUsed: 0 }],
        ['split-1', { terminal: { focus: splitFocus } as never, lastUsed: 0 }],
      ]),
    }))
    expect(primaryFocus).toHaveBeenCalledOnce()
    expect(splitFocus).not.toHaveBeenCalled()
    act(() => useAppStore.getState().activateTab('terminal-1', true))
    expect(primaryFocus).toHaveBeenCalledOnce()
    expect(splitFocus).toHaveBeenCalledOnce()
  })

  it('routes terminal shortcuts through activeSurface', async () => {
    const terminal = {
      getSelection: vi.fn(() => 'selected text'),
      paste: vi.fn(),
      clear: vi.fn(),
      focus: vi.fn(),
    }
    const writeText = vi.fn(async () => {})
    const readText = vi.fn(async () => 'clipboard text')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText, readText } })
    useAppStore.setState({
      tabs: [{ id: 'terminal-1', title: 'Terminal', type: 'terminal', terminalId: 'term-1', sessionId: 1 }],
      activeSurface: { type: 'terminal', id: 'terminal-1' },
      terminalPool: new Map([['term-1', { terminal: terminal as never, lastUsed: 0 }]]),
      activePaneId: null,
    })
    const newSession = vi.fn()
    window.addEventListener('mssh:new-session', newSession)
    render(<App />)
    fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true, shiftKey: true })
    fireEvent.keyDown(document.body, { key: 'v', ctrlKey: true, shiftKey: true })
    fireEvent.keyDown(document.body, { key: 'l', ctrlKey: true, shiftKey: true })
    fireEvent.keyDown(document.body, { key: 'n', ctrlKey: true })
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('selected text'))
    await waitFor(() => expect(terminal.paste).toHaveBeenCalledWith('clipboard text'))
    expect(terminal.clear).toHaveBeenCalledOnce()
    expect(newSession).toHaveBeenCalledOnce()
    window.removeEventListener('mssh:new-session', newSession)
  })
  it('opens session search globally while preserving ordinary form input', () => {
    const openSearch = vi.fn()
    window.addEventListener('mssh:open-session-search', openSearch)
    render(<App />)
    expect(fireEvent.keyDown(document.body, { key: 'f', ctrlKey: true })).toBe(false)
    const terminalInput = document.createElement('textarea')
    terminalInput.className = 'xterm-helper-textarea'
    document.body.append(terminalInput)
    expect(fireEvent.keyDown(terminalInput, { key: 'f', ctrlKey: true })).toBe(false)
    const ordinaryInput = document.createElement('input')
    document.body.append(ordinaryInput)
    expect(fireEvent.keyDown(ordinaryInput, { key: 'f', ctrlKey: true })).toBe(true)
    expect(fireEvent.keyDown(document.body, { key: 'f', metaKey: true })).toBe(false)
    expect(openSearch).toHaveBeenCalledTimes(3)
    terminalInput.remove()
    ordinaryInput.remove()
    window.removeEventListener('mssh:open-session-search', openSearch)
  })
  it('blocks Ctrl+W for a connected active terminal', async () => {
    const closeTab = vi.fn(async () => {})
    useAppStore.setState({
      tabs: [{ id: 'terminal-1', title: 'Terminal', type: 'terminal', terminalId: 'term-1', sessionId: 1 }],
      activeSurface: { type: 'terminal', id: 'terminal-1' },
      connectionStatus: { 'term-1': 'connected' },
      closeTab,
    })
    render(<App />)
    fireEvent.keyDown(document.body, { key: 'w', ctrlKey: true })
    expect(closeTab).not.toHaveBeenCalled()
    expect(await screen.findByRole('status')).toHaveTextContent('请使用标签关闭按钮确认终止活动连接')
  })
  it('reports clipboard shortcut failures', async () => {
    const terminal = { getSelection: vi.fn(() => 'selected text'), paste: vi.fn(), clear: vi.fn(), focus: vi.fn() }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async () => { throw new Error('write denied') }),
        readText: vi.fn(async () => { throw new Error('read denied') }),
      },
    })
    useAppStore.setState({
      tabs: [{ id: 'terminal-1', title: 'Terminal', type: 'terminal', terminalId: 'term-1', sessionId: 1 }],
      activeSurface: { type: 'terminal', id: 'terminal-1' },
      terminalPool: new Map([['term-1', { terminal: terminal as never, lastUsed: 0 }]]),
    })
    render(<App />)
    fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true, shiftKey: true })
    fireEvent.keyDown(document.body, { key: 'v', ctrlKey: true, shiftKey: true })
    expect(await screen.findByText('复制失败: write denied')).toBeInTheDocument()
    expect(await screen.findByText('粘贴失败: read denied')).toBeInTheDocument()
  })
  it('consumes a rejected Ctrl+W close and shows an error toast', async () => {
    const closeTab = vi.fn(async () => { throw new Error('connection lost') })
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const unhandledRejection = vi.fn((event: PromiseRejectionEvent) => event.preventDefault())
    window.addEventListener('unhandledrejection', unhandledRejection)
    useAppStore.setState({
      tabs: [{ id: 'playback-1', title: 'Playback', type: 'playback', recordingPath: '/tmp/playback-1.msshlog' }],
      activeSurface: { type: 'playback', id: 'playback-1' },
      connectionStatus: {},
      recordingState: {},
      closeTab,
    })
    render(<App />)
    fireEvent.keyDown(document.body, { key: 'w', ctrlKey: true })
    await waitFor(() => expect(closeTab).toHaveBeenCalledWith('playback-1'))
    expect(await screen.findByRole('alert')).toHaveTextContent('关闭标签失败: connection lost')
    expect(logError).toHaveBeenCalledWith(
      'close tab failed',
      expect.objectContaining({ tabId: 'playback-1', error: expect.any(Error) }),
    )
    expect(unhandledRejection).not.toHaveBeenCalled()
    window.removeEventListener('unhandledrejection', unhandledRejection)
  })
})
