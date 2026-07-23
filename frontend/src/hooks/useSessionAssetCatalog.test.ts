import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
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
  const catalog = useSessionAssetCatalog({ environments, projects, setEnvironments, setProjects, setTags, setSessions, setRecentSessions, setError })
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
    expect(useToastStore.getState().toasts.some((item) => item.message.includes('catalog failed'))).toBe(true)
  })
})

  it('keeps mutation callers free of refresh toast noise when silent', async () => {
    __registerHandler(service + 'AssetCatalogService.UpdateEnvironment', async () => undefined)
    __registerHandler(service + 'AssetCatalogService.ListEnvironments', async () => { throw new Error('refresh failed') })
    const { result } = renderHook(() => useHarness())
    const environment: AssetEnvironment = { id: '1', name: '生产', colorToken: 'red', sortOrder: 0, sessionCount: 1 }
    await expect(act(async () => result.current.updateEnvironment(environment))).rejects.toThrow('refresh failed')
    expect(useToastStore.getState().toasts.some((item) => item.message.includes('refresh failed'))).toBe(false)
  })

  it('toasts standalone refresh failures by default', async () => {
    __registerHandler(service + 'AssetCatalogService.ListEnvironments', async () => { throw new Error('refresh only failed') })
    const { result } = renderHook(() => useHarness())
    await expect(act(async () => result.current.refreshAssets())).rejects.toThrow('refresh only failed')
    expect(useToastStore.getState().toasts.some((item) => item.message.includes('refresh only failed'))).toBe(true)
  })

