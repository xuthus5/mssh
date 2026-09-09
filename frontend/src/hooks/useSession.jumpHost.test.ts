import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '@/hooks/useSession'
import { useAppStore } from '@/store/appStore'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'

const service = 'github.com/xuthus5/mssh/internal/service.'
const draft = {
  name: 'Private server', host: 'private.internal', port: 22, username: 'root',
  authMethod: 'password' as const, keepAlive: 30, termType: 'xterm-256color', folderId: null,
  jumpHost: { host: 'jump.internal', port: 2222, username: 'admin', authMethod: 'password' as const, password: 'jump-private' },
}

function backendSession() {
  return {
    id: 5, name: draft.name, host: draft.host, port: draft.port, username: draft.username,
    auth_method: 'password', keep_alive: 30, term_type: draft.termType, folder_id: null,
    jump_host: { host: 'jump.internal', port: 2222, username: 'admin', auth_method: 'password', password: 'sealed-private' },
  }
}

beforeEach(() => {
  __clearHandlers()
  useAppStore.setState({ tabs: [], activeSurface: null, terminalPool: new Map() })
  __registerHandler(service + 'SessionService.ListFolders', async () => [])
  __registerHandler(service + 'SessionService.ListSessions', async () => [])
  __registerHandler(service + 'SessionService.ListRecentSessions', async () => [])
  for (const name of ['ListEnvironments', 'ListProjects', 'ListTags']) {
    __registerHandler(service + 'AssetCatalogService.' + name, async () => [])
  }
})

describe('session jump host records', () => {
  it('submits the enabled jump host and strips credentials from list state', async () => {
    const create = vi.fn(async () => backendSession())
    __registerHandler(service + 'SessionService.CreateSession', create)
    const { result } = renderHook(() => useSession())
    await act(async () => { await result.current.createSession(draft) })

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ jump_host: {
      host: 'jump.internal', port: 2222, username: 'admin', auth_method: 'password', password: 'jump-private', key_id: null,
    } }))
    expect(result.current.sessions[0].jumpHost).toMatchObject({ host: 'jump.internal', port: 2222, username: 'admin' })
    expect(result.current.sessions[0].jumpHost).not.toHaveProperty('password')
  })

  it('keeps a new jump password out of optimistic state when refresh fails', async () => {
    __registerHandler(service + 'SessionService.ListSessions', async () => [backendSession()])
    __registerHandler(service + 'SessionService.UpdateSession', async () => {})
    __registerHandler(service + 'SessionService.GetSession', async () => { throw new Error('refresh failed') })
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))
    await act(async () => { await result.current.updateSession({ ...draft, id: '5' }) })

    expect(result.current.sessions[0].jumpHost?.host).toBe('jump.internal')
    expect(JSON.stringify(result.current.sessions)).not.toContain('jump-private')
    expect(JSON.stringify(result.current.sessions)).not.toContain('sealed-private')
  })

  it('saves a disabled jump host and restores the direct session view', async () => {
    __registerHandler(service + 'SessionService.ListSessions', async () => [backendSession()])
    const update = vi.fn(async () => {})
    __registerHandler(service + 'SessionService.UpdateSession', update)
    __registerHandler(service + 'SessionService.GetSession', async () => ({ ...backendSession(), jump_host: null }))
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))
    await act(async () => { await result.current.updateSession({ ...draft, id: '5', jumpHost: undefined }) })

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ jump_host: undefined }))
    expect(result.current.sessions[0].jumpHost).toBeUndefined()
  })
})
