import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '@/components/ui/toast'
import { useSession } from '@/hooks/useSession'
import { useConnectDialog } from '@/store/connectDialog'
import { useAppStore } from '@/store/appStore'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'

const service = 'github.com/xuthus5/mssh/internal/service.'

describe('useSession behavior', () => {
  beforeEach(() => {
    __clearHandlers()
    useAppStore.setState({ tabs: [], activeSurface: null, connectionStatus: {} })
    useConnectDialog.setState({ open: false, state: 'idle', attemptId: '', sessionId: '', error: '', fingerprint: '', algorithm: '' })
  })

  it('remaps folder children and sessions while updating defaults', async () => {
    registerInitial({
      folders: [folder(1, 'Default', null, true), folder(2, 'Old', null, false), folder(3, 'Child', 2, false)],
      sessions: [bindingSession(7, 'Node', 2)],
    })
    __registerHandler(service + 'SessionService.DeleteFolder', async () => {})
    __registerHandler(service + 'SessionService.UpdateFolder', async () => {})
    __registerHandler(service + 'SessionService.SetDefaultFolder', async () => {})
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.folders).toHaveLength(3))

    await act(async () => result.current.deleteFolder('2'))
    expect(result.current.folders.find((item) => item.id === '3')?.parentId).toBe('1')
    expect(result.current.sessions[0].folderId).toBe('1')
    await act(async () => result.current.updateFolder('3', 'Renamed'))
    expect(result.current.folders.find((item) => item.id === '3')?.name).toBe('Renamed')
    await act(async () => result.current.setDefaultFolder('3'))
    expect(result.current.folders.find((item) => item.id === '3')?.isDefault).toBe(true)

    __registerHandler(service + 'SessionService.UpdateFolder', async () => { throw new Error('update failed') })
    await expect(act(async () => result.current.updateFolder('3', 'Nope'))).rejects.toThrow('update failed')
    __registerHandler(service + 'SessionService.DeleteFolder', async () => { throw new Error('delete failed') })
    await expect(act(async () => result.current.deleteFolder('3'))).rejects.toThrow('delete failed')
    __registerHandler(service + 'SessionService.CreateFolder', async () => { throw new Error('create failed') })
    await expect(act(async () => result.current.createFolder('Nope', null))).rejects.toThrow('create failed')
  })

  it('remaps deleteFolder ownership from a single ref snapshot without dropping concurrent folders', async () => {
    registerInitial({
      folders: [folder(1, 'Default', null, true), folder(2, 'Doomed', null, false), folder(3, 'Child', 2, false)],
      sessions: [bindingSession(7, 'Node', 2), bindingSession(8, 'Keep', 1)],
    })
    let releaseDelete: (() => void) | undefined
    const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve })
    __registerHandler(service + 'SessionService.DeleteFolder', async () => { await deleteGate })
    __registerHandler(service + 'SessionService.CreateFolder', async () => folder(4, 'New', null, false))
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.folders).toHaveLength(3))

    let deletePromise: Promise<void> | undefined
    act(() => { deletePromise = result.current.deleteFolder('2') })
    await act(async () => { await result.current.createFolder('New', null) })
    await waitFor(() => expect(result.current.folders.some((item) => item.id === '4')).toBe(true))
    releaseDelete?.()
    await act(async () => { await deletePromise })

    expect(result.current.folders.find((item) => item.id === '2')).toBeUndefined()
    expect(result.current.folders.find((item) => item.id === '3')?.parentId).toBe('1')
    expect(result.current.folders.find((item) => item.id === '4')).toBeTruthy()
    expect(result.current.sessions.find((item) => item.id === '7')?.folderId).toBe('1')
    expect(result.current.sessions.find((item) => item.id === '8')?.folderId).toBe('1')
  })

  it('loads recent sessions and surfaces list errors on the page banner', async () => {
    registerInitial({ recent: [bindingSession(8, 'Recent', null)] })
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.recentSessions).toHaveLength(1))

    __registerHandler(service + 'SessionService.ListSessions', async () => { throw 'sessions failed' })
    await act(async () => result.current.listSessions())
    expect(result.current.error).toBe('sessions failed')
    __registerHandler(service + 'SessionService.ListRecentSessions', async () => { throw new Error('recent failed') })
    await act(async () => result.current.listRecentSessions())
    expect(result.current.error).toBe('recent failed')
  })

  it('moves sessions and preserves state when mutations fail', async () => {
    registerInitial({ sessions: [bindingSession(4, 'Node', null)] })
    __registerHandler(service + 'SessionService.MoveSession', async () => {})
    __registerHandler(service + 'SessionService.DeleteSession', async () => { throw new Error('delete failed') })
    __registerHandler(service + 'SessionService.UpdateSession', async () => { throw 'update failed' })
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))

    await act(async () => result.current.moveSession('4', '2'))
    expect(result.current.sessions[0].folderId).toBe('2')
    __registerHandler(service + 'SessionService.MoveSession', async () => { throw new Error('move failed') })
    await expect(act(async () => result.current.moveSession('4', null))).rejects.toThrow('move failed')
    expect(result.current.sessions[0].folderId).toBe('2')
    await expect(act(async () => result.current.deleteSession('4'))).rejects.toThrow('delete failed')
    expect(result.current.sessions).toHaveLength(1)
    await expect(act(async () => result.current.updateSession(result.current.sessions[0]))).rejects.toBe('update failed')
  })

  it('reports connection failures without creating terminal tabs', async () => {
    registerInitial({ sessions: [bindingSession(5, 'Connect', null)] })
    __registerHandler(service + 'TerminalService.Open', async () => { throw 'open failed' })
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))

    await act(async () => result.current.connect('missing'))
    expect(useConnectDialog.getState().open).toBe(false)
    await act(async () => result.current.connect('5'))
    expect(useConnectDialog.getState()).toMatchObject({ open: true, state: 'failed', error: 'open failed' })
    expect(useAppStore.getState().tabs).toHaveLength(0)
  })

  it('keeps connection success when post-connect session refresh fails', async () => {
    registerInitial({ sessions: [bindingSession(5, 'Connect', null)] })
    __registerHandler(service + 'TerminalService.Open', async () => 'term-ok')
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))
    useToastStore.setState({ toasts: [] })
    __registerHandler(service + 'SessionService.ListSessions', async () => { throw new Error('refresh boom') })
    __registerHandler(service + 'SessionService.ListRecentSessions', async () => { throw new Error('recent boom') })
    await act(async () => result.current.connect('5'))
    expect(useAppStore.getState().tabs).toHaveLength(1)
    expect(useConnectDialog.getState().open).toBe(false)
    expect(useConnectDialog.getState().state).toBe('idle')
    const messages = useToastStore.getState().toasts.map((item) => item.message)
    expect(messages.some((message) => message.includes('加载会话失败'))).toBe(false)
    expect(messages.some((message) => message.includes('加载最近会话失败'))).toBe(false)
  })

  it('closes terminal tabs after batch delete', async () => {
    registerInitial({ sessions: [bindingSession(5, 'One', null), bindingSession(6, 'Two', null)] })
    __registerHandler(service + 'TerminalService.Open', async (sessionID: number) => `term-${sessionID}`)
    __registerHandler(service + 'SessionService.DeleteSessions', async () => {
      __registerHandler(service + 'SessionService.ListSessions', async () => [])
      __registerHandler(service + 'SessionService.ListRecentSessions', async () => [])
      return 2
    })
    __registerHandler(service + 'AuditService.RecordBatch', async () => {})
    const closeTerminal = vi.fn(async () => {})
    __registerHandler(service + 'TerminalService.Close', closeTerminal)
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.sessions).toHaveLength(2))
    await act(async () => { await result.current.batchConnect(['5', '6']) })
    expect(useAppStore.getState().tabs).toHaveLength(2)
    await act(async () => { await result.current.batchDeleteSessions(['5', '6']) })
    await waitFor(() => expect(result.current.sessions).toHaveLength(0))
    await waitFor(() => expect(useAppStore.getState().tabs).toHaveLength(0))
    expect(closeTerminal).toHaveBeenCalled()
  })

  it('closes terminal tabs when deleting a session', async () => {

    registerInitial({ sessions: [bindingSession(5, 'Connect', null)] })
    __registerHandler(service + 'TerminalService.Open', async () => 'term-ok')
    __registerHandler(service + 'SessionService.DeleteSession', async () => undefined)
    const closeTerminal = vi.fn(async () => {})
    __registerHandler(service + 'TerminalService.Close', closeTerminal)
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))
    await act(async () => result.current.connect('5'))
    expect(useAppStore.getState().tabs).toHaveLength(1)
    await act(async () => result.current.deleteSession('5'))
    expect(result.current.sessions).toHaveLength(0)
    expect(useAppStore.getState().tabs).toHaveLength(0)
    expect(closeTerminal).toHaveBeenCalledWith('term-ok')
  })

  it('does not start a second session while another connection dialog is active', async () => {

    registerInitial({ sessions: [bindingSession(5, 'Connect', null)] })
    const openTerminal = vi.fn(async () => 'term-new')
    __registerHandler(service + 'TerminalService.Open', openTerminal)
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))
    useConnectDialog.getState().openDialog('other.internal', 22, 'admin', vi.fn())

    await act(async () => result.current.connect('5'))

    expect(openTerminal).not.toHaveBeenCalled()
    expect(useConnectDialog.getState().host).toBe('other.internal')
  })

  it('runs batch macros independently and closes failed partial terminals', async () => {
    registerInitial({ sessions: [bindingSession(5, 'One', null), bindingSession(6, 'Two', null)] })
    __registerHandler(service + 'TerminalService.Open', async (sessionID: number) => `term-${sessionID}`)
    __registerHandler(service + 'MacroService.Execute', async (terminalID: string) => {
      if (terminalID === 'term-6') throw new Error('write failed')
    })
    const closeTerminal = vi.fn(async () => {})
    __registerHandler(service + 'TerminalService.Close', closeTerminal)
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.sessions).toHaveLength(2))

    let batchResults: Awaited<ReturnType<typeof result.current.batchExecuteMacro>> = []
    await act(async () => { batchResults = await result.current.batchExecuteMacro(['5', '6'], 'uptime\n') })

    expect(batchResults).toEqual([
      expect.objectContaining({ sessionId: '5', success: true, terminalId: 'term-5' }),
      expect.objectContaining({ sessionId: '6', success: false, error: 'write failed' }),
    ])
    expect(closeTerminal).toHaveBeenCalledWith('term-6')
    expect(useAppStore.getState().tabs).toHaveLength(1)
  })

  it('keeps batch macro results when post-batch asset refresh fails', async () => {
    registerInitial({ sessions: [bindingSession(5, 'One', null), bindingSession(6, 'Two', null)] })
    __registerHandler(service + 'TerminalService.Open', async (sessionID: number) => `term-${sessionID}`)
    __registerHandler(service + 'MacroService.Execute', async () => {})
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.sessions).toHaveLength(2))
    __registerHandler(service + 'SessionService.ListSessions', async () => { throw new Error('refresh boom') })
    __registerHandler(service + 'SessionService.ListRecentSessions', async () => { throw new Error('recent boom') })
    __registerHandler(service + 'AssetCatalogService.ListEnvironments', async () => { throw new Error('env boom') })

    let batchResults: Awaited<ReturnType<typeof result.current.batchExecuteMacro>> = []
    await act(async () => {
      batchResults = await result.current.batchExecuteMacro(['5', '6'], 'uptime\n')
    })

    expect(batchResults).toEqual([
      expect.objectContaining({ sessionId: '5', success: true, terminalId: 'term-5' }),
      expect.objectContaining({ sessionId: '6', success: true, terminalId: 'term-6' }),
    ])
    expect(useAppStore.getState().tabs).toHaveLength(2)
  })

  it('keeps batch delete results when post-delete asset refresh fails', async () => {
    registerInitial({ sessions: [bindingSession(5, 'One', null), bindingSession(6, 'Two', null)] })
    __registerHandler(service + 'SessionService.DeleteSessions', async () => 2)
    __registerHandler(service + 'AuditService.RecordBatch', async () => {})
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.sessions).toHaveLength(2))
    __registerHandler(service + 'SessionService.ListSessions', async () => { throw new Error('refresh boom') })
    __registerHandler(service + 'SessionService.ListRecentSessions', async () => { throw new Error('recent boom') })
    __registerHandler(service + 'AssetCatalogService.ListEnvironments', async () => { throw new Error('env boom') })

    let batchResults: Awaited<ReturnType<typeof result.current.batchDeleteSessions>> = []
    await act(async () => {
      batchResults = await result.current.batchDeleteSessions(['5', '6'])
    })

    expect(batchResults.every((item) => item.success)).toBe(true)
    expect(result.current.sessions).toHaveLength(0)
  })

  it('disconnects a specific terminal instance by backend terminal ID', async () => {
    registerInitial({ sessions: [bindingSession(5, 'Connect', null)] })
    const closeTerminal = vi.fn(async () => {})
    __registerHandler(service + 'TerminalService.Close', closeTerminal)
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))

    await act(async () => result.current.disconnect('term-first'))

    expect(closeTerminal).toHaveBeenCalledWith('term-first')
    expect(useAppStore.getState().connectionStatus['term-first']).toBe('disconnected')

    __registerHandler(service + 'TerminalService.Close', async () => { throw new Error('disconnect failed') })
    await act(async () => result.current.disconnect('term-second'))
    expect(useAppStore.getState().connectionStatus['term-second']).toBeUndefined()
  })

  it('opens independent terminal instances for repeated session connections', async () => {
    registerInitial({ sessions: [bindingSession(5, '生产服务器', null)] })
    const openTerminal = vi.fn()
      .mockResolvedValueOnce('term-first')
      .mockResolvedValueOnce('term-second')
    __registerHandler(service + 'TerminalService.Open', openTerminal)
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))

    await act(async () => result.current.connect('5'))
    await act(async () => result.current.connect('5'))

    expect(openTerminal).toHaveBeenCalledTimes(2)
    expect(useAppStore.getState().tabs).toEqual([
      expect.objectContaining({
        id: 'terminal-term-first',
        title: '生产服务器',
        terminalId: 'term-first',
        sessionId: 5,
        terminalInstance: 1,
      }),
      expect.objectContaining({
        id: 'terminal-term-second',
        title: '生产服务器 #2',
        terminalId: 'term-second',
        sessionId: 5,
        terminalInstance: 2,
      }),
    ])
    expect(useAppStore.getState().connectionStatus).toMatchObject({
      'term-first': 'connected',
      'term-second': 'connected',
    })
    expect(useAppStore.getState().activeSurface).toEqual({ type: 'terminal', id: 'terminal-term-second' })
  })

  it('reconnects a disconnected terminal in the existing tab', async () => {
    registerInitial({ sessions: [bindingSession(5, '生产服务器', null)] })
    const openTerminal = vi.fn(async () => 'term-reconnected')
    __registerHandler(service + 'TerminalService.Open', openTerminal)
    useAppStore.setState({
      tabs: [{ id: 'terminal-term-old', title: '生产服务器', type: 'terminal', terminalId: 'term-old', sessionId: 5, terminalInstance: 1 }],
      activeSurface: { type: 'terminal', id: 'terminal-term-old' },
      activePaneId: 'term-old',
      connectionStatus: { 'term-old': 'disconnected' },
      terminalPool: new Map([['term-old', { terminal: { cols: 132, rows: 43 } as never, lastUsed: 0 }]]),
    })
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))

    await act(async () => result.current.reconnect('terminal-term-old'))

    expect(openTerminal).toHaveBeenCalledWith(5, 132, 43)
    expect(useAppStore.getState()).toMatchObject({
      tabs: [expect.objectContaining({ id: 'terminal-term-old', terminalId: 'term-reconnected', terminalInstance: 1 })],
      activeSurface: { type: 'terminal', id: 'terminal-term-old' },
      activePaneId: 'term-reconnected',
      connectionStatus: { 'term-reconnected': 'connected' },
    })
    expect(useAppStore.getState().connectionStatus['term-old']).toBeUndefined()
  })

  it('preserves a disconnected state reported before reconnect replacement completes', async () => {
    registerInitial({ sessions: [bindingSession(5, '生产服务器', null)] })
    __registerHandler(service + 'TerminalService.Open', async () => {
      useAppStore.getState().setConnectionStatus('term-reconnected', 'disconnected')
      return 'term-reconnected'
    })
    useAppStore.setState({
      tabs: [{ id: 'terminal-term-old', title: '生产服务器', type: 'terminal', terminalId: 'term-old', sessionId: 5 }],
      activeSurface: { type: 'terminal', id: 'terminal-term-old' },
      connectionStatus: { 'term-old': 'disconnected' },
    })
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))

    await act(async () => result.current.reconnect('terminal-term-old'))

    expect(useAppStore.getState().connectionStatus['term-reconnected']).toBe('disconnected')
  })

  it('keeps a failed reconnect retryable without replacing the old terminal', async () => {
    registerInitial({ sessions: [bindingSession(5, '生产服务器', null)] })
    __registerHandler(service + 'TerminalService.Open', async () => { throw new Error('network unavailable') })
    useAppStore.setState({
      tabs: [{ id: 'terminal-term-old', title: '生产服务器', type: 'terminal', terminalId: 'term-old', sessionId: 5, terminalInstance: 1 }],
      activeSurface: { type: 'terminal', id: 'terminal-term-old' },
      connectionStatus: { 'term-old': 'disconnected' },
    })
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))

    await act(async () => result.current.reconnect('terminal-term-old'))

    expect(useAppStore.getState().tabs).toEqual([
      expect.objectContaining({ terminalId: 'term-old' }),
    ])
    expect(useAppStore.getState().connectionStatus['term-old']).toBe('error')
    expect(useConnectDialog.getState()).toMatchObject({ state: 'failed', error: 'network unavailable' })
  })
  it('dismisses connect dialog when the target session is deleted', async () => {
    __registerHandler(service + 'SessionService.DeleteSession', async () => undefined)
    const { result } = renderHook(() => useSession())
    useConnectDialog.getState().openDialog('example.com', 22, 'root', vi.fn(), '5')
    expect(useConnectDialog.getState().open).toBe(true)
    await act(async () => { await result.current.deleteSession('5') })
    expect(useConnectDialog.getState()).toMatchObject({ open: false, state: 'idle', sessionId: '' })
  })

  it('cancels in-memory transfers when session is deleted', async () => {
    __registerHandler(service + 'SessionService.DeleteSession', async () => undefined)
    useAppStore.setState({
      transfers: [{
        id: 'job-1', fileName: 'a.txt', direction: 'upload', sessionId: 5, sessionName: 's',
        sourcePath: '/a', targetPath: '/b', totalBytes: 10, transferredBytes: 2, speed: 1, eta: 1,
        status: 'running', startedAt: 1,
      }],
      tabs: [],
      activeSurface: null,
      connectionStatus: {},
    })
    const { result } = renderHook(() => useSession())
    await act(async () => { await result.current.deleteSession('5') })
    expect(useAppStore.getState().transfers[0]).toMatchObject({ status: 'cancelled', error: '会话已删除' })
  })

})

function registerInitial({ folders = [], sessions = [], recent = [] }: { folders?: any[]; sessions?: any[]; recent?: any[] }) {
  __registerHandler(service + 'SessionService.ListFolders', async () => folders)
  __registerHandler(service + 'SessionService.ListSessions', async () => sessions)
  __registerHandler(service + 'SessionService.ListRecentSessions', async () => recent)
	__registerHandler(service + 'AssetCatalogService.ListEnvironments', async () => [])
	__registerHandler(service + 'AssetCatalogService.ListProjects', async () => [])
	__registerHandler(service + 'AssetCatalogService.ListTags', async () => [])
}

function folder(id: number, name: string, parentID: number | null, isDefault: boolean) {
  return { id, name, parent_id: parentID, is_default: isDefault }
}

function bindingSession(id: number, name: string, folderID: number | null) {
  return { id, name, host: `${id}.internal`, port: 22, username: 'root', auth_method: 'password', password: '', key_id: null, keep_alive: 30, term_type: 'xterm', folder_id: folderID, last_connected_at: null, connection_count: 0 }
}
