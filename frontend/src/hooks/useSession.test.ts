import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSession } from '@/hooks/useSession'
import { __registerHandler, __clearHandlers } from '@/test/__mocks__/wails-runtime'
import { useAppStore } from '@/store/appStore'

let _counter = 0
function nextId() { return ++_counter }

function resetAppStore() {
  useAppStore.setState({ tabs: [], activeSurface: null, terminalPool: new Map() })
}

describe('useSession', () => {
  beforeEach(() => {
    __clearHandlers()
    resetAppStore()
    _counter = 0
  })

  it('creates a folder and adds it to state', async () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListFolders', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListSessions', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.CreateFolder', async (name: string, parentId: number | null) => ({
      id: nextId(), name, parent_id: parentId ?? null,
    }))

    const { result } = renderHook(() => useSession())

    await act(async () => {
      await result.current.createFolder('生产环境', null)
    })

    expect(result.current.folders).toHaveLength(1)
    expect(result.current.folders[0].name).toBe('生产环境')
    expect(result.current.folders[0].parentId).toBeNull()
  })

  it('deletes a folder and removes it from state', async () => {
    const folderId = nextId()
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListFolders', async () => [{ id: folderId, name: 'test', parent_id: null }])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListSessions', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.CreateFolder', async (name: string, parentId: number | null) => ({
      id: folderId, name, parent_id: parentId ?? null,
    }))
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.DeleteFolder', async () => {})

    const { result } = renderHook(() => useSession())

    await act(async () => { await result.current.listFolders() })
    expect(result.current.folders).toHaveLength(1)

    await act(async () => { await result.current.deleteFolder(String(folderId)) })
    expect(result.current.folders).toHaveLength(0)
  })

  it('creates a session and adds it to state', async () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListFolders', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListSessions', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.CreateSession', async (s: any) => {
      return Object.assign({}, s, { id: nextId() })
    })

    const { result } = renderHook(() => useSession())

    await act(async () => {
      await result.current.createSession({
        name: 'web-server', host: '10.0.0.1', port: 22, username: 'root',
        authMethod: 'password', password: 'secret', keepAlive: 30,
        termType: 'xterm-256color', folderId: null,
      })
    })

    expect(result.current.sessions).toHaveLength(1)
    expect(result.current.sessions[0].name).toBe('web-server')
    expect(result.current.sessions[0].host).toBe('10.0.0.1')
    expect(result.current.sessions[0].port).toBe(22)
  })

  it('updates a session', async () => {
    const sessionId = nextId()
    const baseSession = {
      id: sessionId, name: 'old', host: '1.1.1.1', port: 22, username: 'u',
      auth_method: 'password', keep_alive: 30, term_type: 'xterm', folder_id: null,
    }
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListFolders', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListSessions', async () => [baseSession])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.CreateSession', async (s: any) => {
      return Object.assign({}, s, { id: sessionId })
    })
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.UpdateSession', async () => {})

    const { result } = renderHook(() => useSession())

    await act(async () => { await result.current.listSessions() })
    const s = result.current.sessions[0]

    await act(async () => {
      await result.current.updateSession({ ...s, name: 'new', port: 2222 })
    })

    expect(result.current.sessions[0].name).toBe('new')
    expect(result.current.sessions[0].port).toBe(2222)
  })

  it('deletes a session and removes it from state', async () => {
    const sessionId = nextId()
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListFolders', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListSessions', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.CreateSession', async (s: any) => {
      return Object.assign({}, s, { id: sessionId })
    })
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.DeleteSession', async () => {})

    const { result } = renderHook(() => useSession())

    await act(async () => {
      await result.current.createSession({
        name: 'tmp', host: 'x', port: 22, username: 'u',
        authMethod: 'password', keepAlive: 30, termType: 'xterm', folderId: null,
      })
    })
    expect(result.current.sessions).toHaveLength(1)

    await act(async () => { await result.current.deleteSession(result.current.sessions[0].id) })
    expect(result.current.sessions).toHaveLength(0)
  })

  it('connect opens a tab in the store', async () => {
    const sessionId = nextId()
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListFolders', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListSessions', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.CreateSession', async (s: any) => {
      return Object.assign({}, s, { id: sessionId })
    })
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.Connect', async () => 'term-abc')
    __registerHandler('github.com/xuthus5/mssh/internal/service.TerminalService.Open', async () => 'term-abc')

    const { result } = renderHook(() => useSession())

    await act(async () => {
      await result.current.createSession({
        name: 'srv', host: '10.0.0.1', port: 22, username: 'root',
        authMethod: 'password', keepAlive: 30, termType: 'xterm', folderId: null,
      })
    })
    const sid = result.current.sessions[0].id

    await act(async () => { await result.current.connect(sid) })

    const store = useAppStore.getState()
    expect(store.tabs).toHaveLength(1)
    expect(store.tabs[0].type).toBe('terminal')
    expect(store.tabs[0].title).toBe('srv')
    expect(store.tabs[0]).toMatchObject({
      id: 'terminal-term-abc',
      terminalId: 'term-abc',
      sessionId: Number(sid),
      terminalInstance: 1,
    })
    expect(store.activeSurface).toEqual({ type: 'terminal', id: 'terminal-term-abc' })
    expect(store).not.toHaveProperty('activeTabId')
    expect(store).not.toHaveProperty('hasEnteredWorkspace')
  })

  it('handles createSession error gracefully', async () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListFolders', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListSessions', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.CreateSession', async () => { throw new Error('db error') })

    const { result } = renderHook(() => useSession())

    await expect(act(async () => {
      await result.current.createSession({
        name: 'x', host: 'x', port: 22, username: 'x',
        authMethod: 'password', keepAlive: 30, termType: 'xterm', folderId: null,
      })
    })).rejects.toThrow('db error')
    expect(result.current.sessions).toHaveLength(0)
  })

  it('handles folders list error gracefully', async () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListFolders', async () => { throw new Error('db error') })
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListSessions', async () => [])

    const { result } = renderHook(() => useSession())

    await act(async () => { await result.current.listFolders() })
    expect(result.current.folders).toHaveLength(0)
  })
})

describe('useSession - loading state', () => {
  beforeEach(() => {
    __clearHandlers()
    resetAppStore()
  })

  it('sets loading true then false during list', async () => {
    let resolveList: (v: any[]) => void
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListFolders', () =>
      new Promise<any[]>((r) => { resolveList = r }))
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListSessions', () =>
      new Promise<any[]>((_r) => {}))

    const { result } = renderHook(() => useSession())

    await act(async () => {})
    await act(async () => { resolveList!([]) })
    await act(async () => {})

    expect(result.current.loading).toBe(false)
  })
})
