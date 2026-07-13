import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useSession } from '@/hooks/useSession'
import { useConnectDialog } from '@/store/connectDialog'
import { useAppStore } from '@/store/appStore'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'

const service = 'github.com/xuthus5/mssh/internal/service.'

describe('useSession behavior', () => {
  beforeEach(() => {
    __clearHandlers()
    useAppStore.setState({ tabs: [], activeSurface: null, connectionStatus: {} })
    useConnectDialog.setState({ open: false, state: 'idle', attemptId: '', error: '', fingerprint: '', algorithm: '' })
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

  it('loads recent sessions and tunnels, including fallback values', async () => {
    registerInitial({ recent: [bindingSession(8, 'Recent', null)] })
    __registerHandler(service + 'TunnelService.List', async () => [{ id: 9, session_id: 8, type: 'dynamic', local_host: null, local_port: 1080, remote_host: null, remote_port: 0 }])
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.recentSessions).toHaveLength(1))
    await act(async () => result.current.listTunnels())
    expect(result.current.tunnels[0]).toEqual({ id: '9', sessionId: '8', type: 'dynamic', localAddress: '', localPort: 1080, remoteAddress: '', remotePort: 0, running: false })

    __registerHandler(service + 'SessionService.ListSessions', async () => { throw 'sessions failed' })
    await act(async () => result.current.listSessions())
    expect(result.current.error).toBe('sessions failed')
    __registerHandler(service + 'SessionService.ListRecentSessions', async () => { throw new Error('recent failed') })
    await act(async () => result.current.listRecentSessions())
    expect(result.current.error).toBe('recent failed')
    __registerHandler(service + 'TunnelService.List', async () => { throw new Error('tunnel failed') })
    await act(async () => result.current.listTunnels())
    expect(result.current.tunnels).toHaveLength(1)
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
    await act(async () => result.current.moveSession('4', null))
    expect(result.current.sessions[0].folderId).toBe('2')
    await act(async () => result.current.deleteSession('4'))
    expect(result.current.sessions).toHaveLength(1)
    await expect(act(async () => result.current.updateSession(result.current.sessions[0]))).rejects.toBe('update failed')
  })

  it('reports connection failures and disconnects active sessions', async () => {
    registerInitial({ sessions: [bindingSession(5, 'Connect', null)] })
    __registerHandler(service + 'TerminalService.Open', async () => { throw 'open failed' })
    __registerHandler(service + 'SessionService.Disconnect', async () => {})
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))

    await act(async () => result.current.connect('missing'))
    expect(useConnectDialog.getState().open).toBe(false)
    await act(async () => result.current.connect('5'))
    expect(useConnectDialog.getState()).toMatchObject({ open: true, state: 'failed', error: 'open failed' })

    await act(async () => result.current.disconnect('5'))
    expect(useAppStore.getState().connectionStatus['terminal-5']).toBe('disconnected')
    __registerHandler(service + 'SessionService.Disconnect', async () => { throw new Error('disconnect failed') })
    await act(async () => result.current.disconnect('5'))
    expect(useAppStore.getState().connectionStatus['terminal-5']).toBe('disconnected')
  })
})

function registerInitial({ folders = [], sessions = [], recent = [] }: { folders?: any[]; sessions?: any[]; recent?: any[] }) {
  __registerHandler(service + 'SessionService.ListFolders', async () => folders)
  __registerHandler(service + 'SessionService.ListSessions', async () => sessions)
  __registerHandler(service + 'SessionService.ListRecentSessions', async () => recent)
}

function folder(id: number, name: string, parentID: number | null, isDefault: boolean) {
  return { id, name, parent_id: parentID, is_default: isDefault }
}

function bindingSession(id: number, name: string, folderID: number | null) {
  return { id, name, host: `${id}.internal`, port: 22, username: 'root', auth_method: 'password', password: '', key_id: null, keep_alive: 30, term_type: 'xterm', folder_id: folderID, last_connected_at: null, connection_count: 0 }
}
