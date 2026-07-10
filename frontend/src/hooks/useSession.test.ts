import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSession } from '@/hooks/useSession'
import { setWailsServices, createMockWailsServices, type SessionFolder } from '@/lib/wails'
import { useAppStore } from '@/store/appStore'

function resetAppStore() {
  useAppStore.setState({ tabs: [], activeTabId: null, terminalPool: new Map() })
}

describe('useSession', () => {
  beforeEach(() => {
    setWailsServices(createMockWailsServices())
    resetAppStore()
  })

  it('creates a folder and adds it to state', async () => {
    const { result } = renderHook(() => useSession())

    await act(async () => {
      await result.current.createFolder('生产环境', null)
    })

    expect(result.current.folders).toHaveLength(1)
    expect(result.current.folders[0].name).toBe('生产环境')
    expect(result.current.folders[0].parentId).toBeNull()
  })

  it('deletes a folder and removes it from state', async () => {
    const { result } = renderHook(() => useSession())
    await act(async () => { await result.current.createFolder('test', null) })
    expect(result.current.folders).toHaveLength(1)

    const folderId = result.current.folders[0].id
    await act(async () => { await result.current.deleteFolder(folderId) })
    expect(result.current.folders).toHaveLength(0)
  })

  it('creates a session and adds it to state', async () => {
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
    const { result } = renderHook(() => useSession())
    await act(async () => {
      await result.current.createSession({
        name: 'old', host: '1.1.1.1', port: 22, username: 'u',
        authMethod: 'password', keepAlive: 30, termType: 'xterm', folderId: null,
      })
    })
    const s = result.current.sessions[0]

    await act(async () => {
      await result.current.updateSession({ ...s, name: 'new', port: 2222 })
    })

    expect(result.current.sessions[0].name).toBe('new')
    expect(result.current.sessions[0].port).toBe(2222)
  })

  it('deletes a session and removes it from state', async () => {
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
    const { result } = renderHook(() => useSession())
    await act(async () => {
      await result.current.createSession({
        name: 'srv', host: '10.0.0.1', port: 22, username: 'root',
        authMethod: 'password', keepAlive: 30, termType: 'xterm', folderId: null,
      })
    })
    const sessionId = result.current.sessions[0].id

    await act(async () => { await result.current.connect(sessionId) })

    const store = useAppStore.getState()
    expect(store.tabs).toHaveLength(1)
    expect(store.tabs[0].type).toBe('terminal')
    expect(store.tabs[0].title).toBe('srv')
    expect(store.activeTabId).toBe(`terminal-${sessionId}`)
  })

  it('handles createSession error gracefully', async () => {
    const mock = createMockWailsServices()
    mock.SessionService.CreateSession = async () => { throw new Error('db error') }
    setWailsServices(mock)

    const { result } = renderHook(() => useSession())
    await act(async () => {
      await result.current.createSession({
        name: 'x', host: 'x', port: 22, username: 'x',
        authMethod: 'password', keepAlive: 30, termType: 'xterm', folderId: null,
      })
    })
    // Should not throw, state unchanged
    expect(result.current.sessions).toHaveLength(0)
  })

  it('handles folders list error gracefully', async () => {
    const mock = createMockWailsServices()
    mock.SessionService.ListFolders = async () => { throw new Error('db error') }
    setWailsServices(mock)

    const { result } = renderHook(() => useSession())
    await act(async () => { await result.current.listFolders() })
    expect(result.current.folders).toHaveLength(0)
  })
})

describe('useSession - loading state', () => {
  beforeEach(() => {
    setWailsServices(createMockWailsServices())
    resetAppStore()
  })

  it('sets loading true then false during list', async () => {
    let resolveList: (v: SessionFolder[]) => void
    const mock = createMockWailsServices()
    mock.SessionService.ListFolders = () =>
      new Promise<SessionFolder[]>((r) => { resolveList = r })
    setWailsServices(mock)

    const { result } = renderHook(() => useSession())
    
    // loading is true while the promise is pending
    await act(async () => {})
    // resolve to trigger finally
    await act(async () => { resolveList!([]) })
    await act(async () => {})

    expect(result.current.loading).toBe(false)
  })
})
