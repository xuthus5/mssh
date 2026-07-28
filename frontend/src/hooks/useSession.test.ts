import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSession } from '@/hooks/useSession'
import { useToastStore } from '@/components/ui/toast'
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
	__registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListRecentSessions', async () => [])
	__registerHandler('github.com/xuthus5/mssh/internal/service.AssetCatalogService.ListEnvironments', async () => [])
	__registerHandler('github.com/xuthus5/mssh/internal/service.AssetCatalogService.ListProjects', async () => [])
	__registerHandler('github.com/xuthus5/mssh/internal/service.AssetCatalogService.ListTags', async () => [])
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
	__registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.GetSession', async () => ({ ...baseSession, name: 'new', port: 2222 }))

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


  it('keeps createSession success when catalog refresh fails', async () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListFolders', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListSessions', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.CreateSession', async (s: any) => ({
      id: 99, name: s.name, host: s.host, port: s.port, username: s.username, auth_method: s.auth_method,
      keep_alive: s.keep_alive, term_type: s.term_type, folder_id: null, notes: '', tags: [],
    }))
    __registerHandler('github.com/xuthus5/mssh/internal/service.AssetCatalogService.ListEnvironments', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.AssetCatalogService.ListProjects', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.AssetCatalogService.ListTags', async () => [])
    const { result } = renderHook(() => useSession())
    await act(async () => { await result.current.listAssetCatalogs() })
    useToastStore.setState({ toasts: [] })
    __registerHandler('github.com/xuthus5/mssh/internal/service.AssetCatalogService.ListEnvironments', async () => { throw new Error('catalog refresh boom') })
    await act(async () => {
      await result.current.createSession({
        name: 'ok', host: '1.1.1.1', port: 22, username: 'root',
        authMethod: 'password', keepAlive: 30, termType: 'xterm', folderId: null,
      })
    })
    expect(result.current.sessions.some((item) => item.name === 'ok')).toBe(true)
    expect(useToastStore.getState().toasts.some((item) => item.message.includes('创建会话失败'))).toBe(false)
    expect(useToastStore.getState().toasts.some((item) => item.message.includes('catalog refresh boom'))).toBe(false)
    expect(useToastStore.getState().toasts.some((item) => item.message.includes('加载资产分类失败'))).toBe(false)
  })

  it('keeps updateSession success when GetSession refresh fails', async () => {
    useToastStore.setState({ toasts: [] })
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListFolders', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListSessions', async () => [{
      id: 7, name: 'old', host: '1.1.1.1', port: 22, username: 'root', auth_method: 'password',
      keep_alive: 30, term_type: 'xterm', folder_id: null, notes: '', tags: [],
    }])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.UpdateSession', async () => undefined)
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.GetSession', async () => { throw new Error('get boom') })
    __registerHandler('github.com/xuthus5/mssh/internal/service.AssetCatalogService.ListEnvironments', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.AssetCatalogService.ListProjects', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.AssetCatalogService.ListTags', async () => [])
    const { result } = renderHook(() => useSession())
    await act(async () => { await result.current.listSessions() })
    useToastStore.setState({ toasts: [] })
    await act(async () => {
      await result.current.updateSession({
        id: '7', name: 'new', host: '1.1.1.1', port: 2222, username: 'root',
        authMethod: 'password', keepAlive: 30, termType: 'xterm', folderId: null,
      } as any)
    })
    expect(result.current.sessions.find((item) => item.id === '7')?.name).toBe('new')
    expect(useToastStore.getState().toasts.some((item) => item.message.includes('更新会话失败'))).toBe(false)
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
    let resolveSessions: (v: any[]) => void
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListFolders', () =>
      new Promise<any[]>((r) => { resolveList = r }))
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListSessions', () =>
      new Promise<any[]>((resolve) => { resolveSessions = resolve }))
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListRecentSessions', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.AssetCatalogService.ListEnvironments', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.AssetCatalogService.ListProjects', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.AssetCatalogService.ListTags', async () => [])

    const { result } = renderHook(() => useSession())

    await act(async () => {})
    await act(async () => { resolveList!([]) })
    await act(async () => {})
    expect(result.current.loading).toBe(true)
    await act(async () => { resolveSessions!([]) })

    expect(result.current.loading).toBe(false)
  })

  it('keeps the newest session list when requests resolve out of order', async () => {
    const first = deferred<any[]>()
    const second = deferred<any[]>()
    let calls = 0
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListFolders', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListRecentSessions', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.AssetCatalogService.ListEnvironments', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.AssetCatalogService.ListProjects', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.AssetCatalogService.ListTags', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListSessions', async () => {
      calls++
      return calls === 1 ? first.promise : second.promise
    })
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(calls).toBe(1))
    let firstLoad!: Promise<void>
    act(() => { firstLoad = result.current.listSessions() })
    await waitFor(() => expect(calls).toBe(2))
    await act(async () => { second.resolve([sessionBinding(2, '新会话')]); await firstLoad })
    expect(result.current.sessions[0].name).toBe('新会话')
    await act(async () => { first.resolve([sessionBinding(1, '旧会话')]); await Promise.resolve() })
    expect(result.current.sessions[0].name).toBe('新会话')
  })

  it('does not let an older session refresh overwrite a newer update', async () => {
    const firstRefresh = deferred<any>()
    const secondRefresh = deferred<any>()
    let refreshCalls = 0
    const base = sessionBinding(7, '初始会话')
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListFolders', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListSessions', async () => [base])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.UpdateSession', async () => undefined)
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.GetSession', async () => {
      refreshCalls++
      return refreshCalls === 1 ? firstRefresh.promise : secondRefresh.promise
    })
    const { result } = renderHook(() => useSession())
    await act(async () => { await result.current.listSessions() })

    const older = { ...result.current.sessions[0], name: '旧编辑' }
    const newer = { ...result.current.sessions[0], name: '新编辑' }
    let olderRequest!: Promise<void>
    let newerRequest!: Promise<void>
    act(() => {
      olderRequest = result.current.updateSession(older)
      newerRequest = result.current.updateSession(newer)
    })
    await waitFor(() => expect(refreshCalls).toBe(2))
    await act(async () => { secondRefresh.resolve({ ...base, name: '新编辑' }); await newerRequest })
    await act(async () => { firstRefresh.resolve({ ...base, name: '旧编辑' }); await olderRequest })

    expect(result.current.sessions[0].name).toBe('新编辑')
  })

  it('invalidates an in-flight list after deleting its session', async () => {
    const staleList = deferred<any[]>()
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListFolders', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListSessions', async () => staleList.promise)
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.DeleteSession', async () => undefined)
    const { result } = renderHook(() => useSession())

    await act(async () => { await result.current.deleteSession('7') })
    await act(async () => { staleList.resolve([sessionBinding(7, '已删除会话')]) })

    expect(result.current.sessions).toEqual([])
  })

  it('does not let an older asset refresh restore a deleted session', async () => {
    const staleSessions = deferred<any[]>()
    const existing = sessionBinding(7, '待删除会话')
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListFolders', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListSessions', async () => [existing])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListRecentSessions', async () => [existing])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.DeleteSession', async () => undefined)
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))

    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListSessions', async () => staleSessions.promise)
    let refresh!: Promise<void>
    act(() => { refresh = result.current.refreshAssets() })
    await act(async () => { await result.current.deleteSession('7') })
    await act(async () => { staleSessions.resolve([existing]); await refresh })

    expect(result.current.sessions).toEqual([])
    expect(result.current.recentSessions).toEqual([])
  })

  it('does not let an update refresh restore a session deleted afterward', async () => {
    const refresh = deferred<any>()
    const existing = sessionBinding(7, '待删除会话')
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListFolders', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListSessions', async () => [existing])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.UpdateSession', async () => undefined)
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.GetSession', async () => refresh.promise)
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.DeleteSession', async () => undefined)
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))

    let update!: Promise<void>
    act(() => { update = result.current.updateSession({ ...result.current.sessions[0], name: '旧更新' }) })
    await act(async () => { await result.current.deleteSession('7') })
    await act(async () => { refresh.resolve({ ...existing, name: '旧更新' }); await update })

    expect(result.current.sessions).toEqual([])
  })

  it('batch deletes selected sessions and removes them from state', async () => {
    const firstId = nextId()
    const secondId = nextId()
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListFolders', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListSessions', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.ListRecentSessions', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.AssetCatalogService.ListEnvironments', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.AssetCatalogService.ListProjects', async () => [])
    __registerHandler('github.com/xuthus5/mssh/internal/service.AssetCatalogService.ListTags', async () => [])
    let created = 0
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.CreateSession', async (s: any) => {
      created += 1
      return Object.assign({}, s, { id: created === 1 ? firstId : secondId })
    })
    __registerHandler('github.com/xuthus5/mssh/internal/service.SessionService.DeleteSessions', async () => 2)
    __registerHandler('github.com/xuthus5/mssh/internal/service.AuditService.RecordBatch', async () => {})

    const { result } = renderHook(() => useSession())
    await act(async () => {
      await result.current.createSession({
        name: 'a', host: '1', port: 22, username: 'u',
        authMethod: 'password', keepAlive: 30, termType: 'xterm', folderId: null,
      })
      await result.current.createSession({
        name: 'b', host: '2', port: 22, username: 'u',
        authMethod: 'password', keepAlive: 30, termType: 'xterm', folderId: null,
      })
    })
    expect(result.current.sessions).toHaveLength(2)

    let results: any[] = []
    await act(async () => {
      results = await result.current.batchDeleteSessions(result.current.sessions.map((session) => session.id))
    })
    expect(results.every((item) => item.success)).toBe(true)
    expect(result.current.sessions).toHaveLength(0)
  })

})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function sessionBinding(id: number, name: string) {
  return { id, name, host: `${id}.internal`, port: 22, username: 'root', auth_method: 'password', keep_alive: 30, term_type: 'xterm', folder_id: null }
}
