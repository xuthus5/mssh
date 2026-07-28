import { act, renderHook, waitFor } from '@testing-library/react'
import { useCallback, useRef, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionAssetCatalog } from '@/hooks/useSessionAssetCatalog'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'
import type { AssetEnvironment, AssetProject, AssetTag, Session } from '@/lib/sessionModels'
import { useToastStore } from '@/components/ui/toast'

const service = 'github.com/xuthus5/mssh/internal/service.'

function bindingEnvironment(id: number, name: string) { return { id, name, color_token: 'red', sort_order: 0, session_count: 0, created_at: '', updated_at: '' } }
function bindingProject(id: number, name: string) { return { id, name, code: 'PAY', description: 'desc', sort_order: 0, session_count: 0, created_at: '', updated_at: '' } }
function bindingTag(id: number, name: string) { return { id, name, color_token: 'blue', session_count: 0, created_at: '', updated_at: '' } }
function bindingSession(id: number) { return { id, name: 'server', host: 'host', port: 22, username: 'root', auth_method: 'agent', keep_alive: 30, term_type: 'xterm', folder_id: null, notes: '', tags: [] } }

function useHarness() {
  const [environments, setEnvironments] = useState<AssetEnvironment[]>([])
  const [projects, setProjects] = useState<AssetProject[]>([])
  const [tags, setTags] = useState<AssetTag[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [recentSessions, setRecentSessions] = useState<Session[]>([])
  const [error, setError] = useState('')
  const sessionRequest = useRef(0)
  const recentRequest = useRef(0)
  const beginSessionSnapshot = useCallback(() => {
    const request = ++sessionRequest.current
    return () => sessionRequest.current === request
  }, [])
  const beginRecentSnapshot = useCallback(() => {
    const request = ++recentRequest.current
    return () => recentRequest.current === request
  }, [])
  const catalog = useSessionAssetCatalog({
    environments, projects, setEnvironments, setProjects, setTags, setSessions, setRecentSessions, setError,
    beginSessionSnapshot, beginRecentSnapshot,
  })
  return { ...catalog, environments, projects, tags, sessions, recentSessions, error }
}

function registerLists() {
  __registerHandler(service + 'AssetCatalogService.ListEnvironments', async () => [bindingEnvironment(1, '生产')])
  __registerHandler(service + 'AssetCatalogService.ListProjects', async () => [bindingProject(2, '支付')])
  __registerHandler(service + 'AssetCatalogService.ListTags', async () => [bindingTag(3, '核心')])
  __registerHandler(service + 'SessionService.ListSessions', async () => [bindingSession(4)])
  __registerHandler(service + 'SessionService.ListRecentSessions', async () => [bindingSession(4)])
}

describe('useSessionAssetCatalog', () => {
  beforeEach(() => { __clearHandlers(); registerLists(); useToastStore.setState({ toasts: [] }) })

  it('loads and creates all catalog kinds', async () => {
    __registerHandler(service + 'AssetCatalogService.CreateEnvironment', async () => bindingEnvironment(5, '预发'))
    __registerHandler(service + 'AssetCatalogService.CreateProject', async () => bindingProject(6, '订单'))
    __registerHandler(service + 'AssetCatalogService.CreateTag', async () => bindingTag(7, 'Linux'))
    const { result } = renderHook(() => useHarness())
    await act(async () => result.current.listAssetCatalogs())
    expect(result.current.environments[0].name).toBe('生产')
    await act(async () => { await result.current.createEnvironment('预发', 'amber'); await result.current.createProject('订单', 'ORDER', '订单项目'); await result.current.createTag('Linux', 'green') })
    expect(result.current.environments.at(-1)?.name).toBe('预发')
    expect(result.current.projects.at(-1)?.name).toBe('订单')
    expect(result.current.tags.at(-1)?.name).toBe('Linux')
  })

  it('refreshes sessions after updates, deletes, reorders, and bulk operations', async () => {
    const calls = new Map<string, ReturnType<typeof vi.fn>>()
    for (const method of ['UpdateEnvironment', 'UpdateProject', 'UpdateTag', 'DeleteEnvironment', 'DeleteProject', 'DeleteTag', 'ReorderEnvironments', 'ReorderProjects']) {
      const handler = vi.fn(async () => undefined); calls.set(method, handler); __registerHandler(service + 'AssetCatalogService.' + method, handler)
    }
    for (const method of ['BulkSetEnvironment', 'BulkSetProject', 'BulkUpdateTags']) {
      const handler = vi.fn(async () => 2); calls.set(method, handler); __registerHandler(service + 'AssetCatalogService.' + method, handler)
    }
    const { result } = renderHook(() => useHarness())
    const environment: AssetEnvironment = { id: '1', name: '生产', colorToken: 'red', sortOrder: 0, sessionCount: 1 }
    const project: AssetProject = { id: '2', name: '支付', code: 'PAY', description: '', sortOrder: 0, sessionCount: 1 }
    const tag: AssetTag = { id: '3', name: '核心', colorToken: 'blue', sessionCount: 1 }
    await act(async () => {
      await result.current.updateEnvironment(environment); await result.current.updateProject(project); await result.current.updateTag(tag)
      await result.current.deleteEnvironment({ id: 1, mode: 'clear', replacement_id: null }); await result.current.deleteProject({ id: 2, mode: 'clear', replacement_id: null }); await result.current.deleteTag('3')
      await result.current.reorderEnvironments(['1']); await result.current.reorderProjects(['2'])
      expect(await result.current.bulkSetEnvironment(['4', '5'], null)).toBe(2)
      expect(await result.current.bulkSetProject(['4', '5'], '2')).toBe(2)
      expect(await result.current.bulkUpdateTags(['4', '5'], ['3'], 'replace')).toBe(2)
    })
    for (const handler of calls.values()) expect(handler).toHaveBeenCalled()
    expect(result.current.sessions).toHaveLength(1)
    expect(result.current.recentSessions).toHaveLength(1)
  })

  it('reports catalog loading failures', async () => {
    __registerHandler(service + 'AssetCatalogService.ListEnvironments', async () => { throw new Error('catalog failed') })
    const { result } = renderHook(() => useHarness())
    await act(async () => result.current.listAssetCatalogs())
    expect(result.current.error).toBe('catalog failed')
    expect(useToastStore.getState().toasts.some((item) => item.message.includes('catalog failed'))).toBe(false)
  })

  it('keeps mutation success when post-mutation silent refresh fails', async () => {
    __registerHandler(service + 'AssetCatalogService.UpdateEnvironment', async () => undefined)
    __registerHandler(service + 'AssetCatalogService.ListEnvironments', async () => { throw new Error('refresh failed') })
    const { result } = renderHook(() => useHarness())
    const environment: AssetEnvironment = { id: '1', name: '生产', colorToken: 'red', sortOrder: 0, sessionCount: 1 }
    await act(async () => result.current.updateEnvironment(environment))
    expect(useToastStore.getState().toasts.some((item) => item.message.includes('refresh failed'))).toBe(false)
  })

  it('sets page error on standalone refresh failures without toast', async () => {
    __registerHandler(service + 'AssetCatalogService.ListEnvironments', async () => { throw new Error('refresh only failed') })
    const { result } = renderHook(() => useHarness())
    await act(async () => { await result.current.refreshAssets() })
    expect(result.current.error).toBe('refresh only failed')
    expect(useToastStore.getState().toasts.some((item) => item.message.includes('refresh only failed'))).toBe(false)
  })

  it('keeps the newest asset catalog when loads resolve out of order', async () => {
    const first = deferred<unknown[]>()
    const second = deferred<unknown[]>()
    let loads = 0
    __registerHandler(service + 'AssetCatalogService.ListEnvironments', async () => {
      loads++
      return loads === 1 ? first.promise : second.promise
    })
    const { result } = renderHook(() => useHarness())
    let firstLoad!: Promise<void>
    act(() => { firstLoad = result.current.listAssetCatalogs() })
    await waitFor(() => expect(loads).toBe(1))
    let secondLoad!: Promise<void>
    act(() => { secondLoad = result.current.listAssetCatalogs() })
    await waitFor(() => expect(loads).toBe(2))
    await act(async () => { second.resolve([bindingEnvironment(2, '新环境')]); await secondLoad })
    expect(result.current.environments[0].name).toBe('新环境')
    await act(async () => { first.resolve([bindingEnvironment(1, '旧环境')]); await firstLoad })
    expect(result.current.environments[0].name).toBe('新环境')
  })

  it('shares latest-wins ordering between catalog and full refresh loads', async () => {
    const first = deferred<unknown[]>()
    const second = deferred<unknown[]>()
    let loads = 0
    __registerHandler(service + 'AssetCatalogService.ListEnvironments', async () => {
      loads++
      return loads === 1 ? first.promise : second.promise
    })
    const { result } = renderHook(() => useHarness())
    let catalogLoad!: Promise<void>
    act(() => { catalogLoad = result.current.listAssetCatalogs() })
    await waitFor(() => expect(loads).toBe(1))
    let fullRefresh!: Promise<void>
    act(() => { fullRefresh = result.current.refreshAssets() })
    await waitFor(() => expect(loads).toBe(2))
    await act(async () => { second.resolve([bindingEnvironment(2, '刷新环境')]); await fullRefresh })
    await act(async () => { first.resolve([bindingEnvironment(1, '旧目录')]); await catalogLoad })
    expect(result.current.environments[0].name).toBe('刷新环境')
  })

  it('invalidates an older catalog load after creating an asset', async () => {
    const pending = deferred<unknown[]>()
    __registerHandler(service + 'AssetCatalogService.ListEnvironments', async () => pending.promise)
    __registerHandler(service + 'AssetCatalogService.CreateEnvironment', async () => bindingEnvironment(2, '新环境'))
    const { result } = renderHook(() => useHarness())
    let catalogLoad!: Promise<void>
    act(() => { catalogLoad = result.current.listAssetCatalogs() })
    await act(async () => { await result.current.createEnvironment('新环境', 'green') })
    await act(async () => { pending.resolve([bindingEnvironment(1, '旧环境')]); await catalogLoad })
    expect(result.current.environments.map((item) => item.name)).toEqual(['新环境'])
  })

  it('clears a previous catalog error after a successful retry', async () => {
    let attempts = 0
    __registerHandler(service + 'AssetCatalogService.ListEnvironments', async () => {
      attempts++
      if (attempts === 1) throw new Error('temporary failure')
      return [bindingEnvironment(1, '恢复环境')]
    })
    const { result } = renderHook(() => useHarness())
    await act(async () => result.current.listAssetCatalogs())
    expect(result.current.error).toBe('temporary failure')
    await act(async () => result.current.listAssetCatalogs())
    expect(result.current.error).toBe('')
  })

  it('does not write a completed load after unmount', async () => {
    const pending = deferred<unknown[]>()
    const setEnvironments = vi.fn()
    const setters = {
      environments: [], projects: [], setEnvironments, setProjects: vi.fn(), setTags: vi.fn(),
      setSessions: vi.fn(), setRecentSessions: vi.fn(), setError: vi.fn(),
      beginSessionSnapshot: () => () => true, beginRecentSnapshot: () => () => true,
    }
    __registerHandler(service + 'AssetCatalogService.ListEnvironments', async () => pending.promise)
    const { result, unmount } = renderHook(() => useSessionAssetCatalog(setters))
    let catalogLoad!: Promise<void>
    act(() => { catalogLoad = result.current.listAssetCatalogs() })
    unmount()
    await act(async () => { pending.resolve([bindingEnvironment(1, '卸载环境')]); await catalogLoad })
    expect(setEnvironments).not.toHaveBeenCalled()
    expect(setters.setError).not.toHaveBeenCalled()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
