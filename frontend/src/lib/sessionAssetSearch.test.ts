import { describe, expect, it } from 'vitest'
import { emptySessionAssetFilters, filterSessionAssets, sessionAssetSearchText } from '@/lib/sessionAssetSearch'
import type { Folder, Session } from '@/lib/sessionModels'

const folders: Folder[] = [{ id: 'folder', name: '核心分组', parentId: null, isDefault: true }]
const sessions: Session[] = [
  {
    id: '1', name: '数据库', host: 'db.internal', port: 22, username: 'root', authMethod: 'agent', keepAlive: 30,
    termType: 'xterm', folderId: 'folder', notes: '敏感维护说明', environmentId: 'env', projectId: 'project',
    environment: { id: 'env', name: '生产', colorToken: 'red', sortOrder: 0, sessionCount: 1 },
    project: { id: 'project', name: '支付平台', code: 'PAY', description: '', sortOrder: 0, sessionCount: 1 },
    tags: [{ id: 'tag-a', name: '核心', colorToken: 'blue', sessionCount: 1 }], connectionCount: 7,
    lastConnectedAt: '2026-07-10T00:00:00Z',
  },
  { id: '2', name: '空资产', host: 'empty.internal', port: 22, username: 'ops', authMethod: 'agent', keepAlive: 30, termType: 'xterm', folderId: null, notes: '', tags: [], connectionCount: 0 },
]

describe('session asset search', () => {
  it('matches all public asset fields but excludes notes', () => {
    const text = sessionAssetSearchText(sessions[0], folders[0].name)
    for (const value of ['数据库', 'db.internal', 'root', '核心分组', '生产', '支付平台', 'pay', '核心']) expect(text).toContain(value.toLocaleLowerCase())
    expect(text).not.toContain('敏感维护说明')
  })

  it('combines same-category OR and cross-category AND filters', () => {
    const result = filterSessionAssets(sessions, folders, {
      ...emptySessionAssetFilters, environmentIds: ['missing', 'env'], projectIds: ['project'], tagIds: ['missing', 'tag-a'], minConnections: 5,
    })
    expect(result.map((item) => item.id)).toEqual(['1'])
  })

  it('supports unset filters and explicit notes matching', () => {
    expect(filterSessionAssets(sessions, folders, { ...emptySessionAssetFilters, includeUnsetEnvironment: true, includeUnsetProject: true, includeUntagged: true }).map((item) => item.id)).toEqual(['2'])
    expect(filterSessionAssets(sessions, folders, { ...emptySessionAssetFilters, notesQuery: '维护' }).map((item) => item.id)).toEqual(['1'])
  })
})
