import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionAssetFilterStore } from '@/store/sessionAssetFilterStore'

const state = {
  folders: [{ id: '1', name: '默认分组', parentId: null, isDefault: true }, { id: '2', name: '生产环境', parentId: null, isDefault: false }],
  sessions: [session('1', '生产服务器', '2'), session('2', '测试服务器', '1')],
  recentSessions: [{ ...session('1', '生产服务器', '2'), lastConnectedAt: '2026-07-12T12:00:00Z', connectionCount: 3 }],
  loading: false,
  error: '',
  environments: [], projects: [], tags: [],
  listFolders: vi.fn(async () => {}), listSessions: vi.fn(async () => {}), listRecentSessions: vi.fn(async () => {}),
  connect: vi.fn(async () => {}), deleteFolder: vi.fn(async () => {}), deleteSession: vi.fn(async () => {}), setDefaultFolder: vi.fn(async () => {}),
  moveSession: vi.fn(async () => {}),
  listAssetCatalogs: vi.fn(async () => {}),
  bulkSetEnvironment: vi.fn(async () => 0), bulkSetProject: vi.fn(async () => 0), bulkUpdateTags: vi.fn(async () => 0),
  createEnvironment: vi.fn(), createProject: vi.fn(), createTag: vi.fn(), updateEnvironment: vi.fn(), updateProject: vi.fn(), updateTag: vi.fn(),
  deleteEnvironment: vi.fn(), deleteProject: vi.fn(), deleteTag: vi.fn(), reorderEnvironments: vi.fn(), reorderProjects: vi.fn(),
  batchConnect: vi.fn(async (ids: string[]) => ids.map((id) => ({ sessionId: id, name: id === '1' ? '生产服务器' : '测试服务器', success: id === '1' }))),
  batchExecuteMacro: vi.fn(async () => []),
  exportSessionsCSV: vi.fn(async () => ({ count: 0, included_passwords: false })),
  importSessionsCSV: vi.fn(async () => ({ total: 0, imported: 0, updated: 0, skipped: 0, failed: 0, results: [] })),
}

vi.mock('@/hooks/SessionWorkspaceContext', () => ({ useSessionWorkspace: () => state }))
vi.mock('@/lib/wails', () => ({
  SessionService: { SessionDeleteImpact: vi.fn(async () => ({ tunnels: 0, history: 0, recordings: 0 })) },
  AssetCatalogService: { EnvironmentDeleteImpact: vi.fn(), ProjectDeleteImpact: vi.fn(), TagDeleteImpact: vi.fn() },
  MacroService: { List: vi.fn(async () => [{ id: 9, name: '巡检', command: 'uptime\n' }]) },
}))

import { SessionAssetCenter } from '@/components/session/SessionAssetCenter'

describe('SessionAssetCenter', () => {
  beforeEach(() => useSessionAssetFilterStore.getState().resetFilters())
  it('renders recent, folder, and node asset tabs', () => {
    render(<SessionAssetCenter />)
    expect(screen.getByRole('tab', { name: /最近连接/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /分组/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /所有节点/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /分类管理/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导入' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导出' })).toBeInTheDocument()
    expect(screen.getByText('生产服务器')).toBeInTheDocument()
  })

  it('opens a folder in the filtered node tab', async () => {
    render(<SessionAssetCenter />)
    await userEvent.click(screen.getByRole('tab', { name: /分组/ }))
    await userEvent.click(screen.getByRole('button', { name: '生产环境' }))
    expect(screen.getByRole('tab', { name: /所有节点/ })).toHaveAttribute('data-active')
    expect(screen.getByText('生产服务器')).toBeInTheDocument()
    expect(screen.queryByText('测试服务器')).not.toBeInTheDocument()
  })

  it('offers session and folder creation from one menu', async () => {
    render(<SessionAssetCenter />)
    await userEvent.click(screen.getByRole('button', { name: '创建' }))
    expect(await screen.findByText('新建会话')).toBeInTheDocument()
    expect(screen.getByText('新建分组目录')).toBeInTheDocument()
  })

  it('selects multiple sessions, confirms batch connection, and shows per-node results', async () => {
    render(<SessionAssetCenter />)
    await userEvent.click(screen.getByRole('tab', { name: /所有节点/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: '选择 生产服务器' }))
    await userEvent.click(screen.getByRole('checkbox', { name: '选择 测试服务器' }))
    await userEvent.click(screen.getByRole('button', { name: '批量连接' }))

    expect(screen.getByRole('alertdialog')).toHaveTextContent('即将为 2 个会话建立 SSH 连接')
    await userEvent.click(screen.getByRole('button', { name: '确认执行' }))

    expect(state.batchConnect).toHaveBeenCalledWith(['1', '2'])
    expect(await screen.findByText('成功 1 项，失败 1 项。')).toBeInTheDocument()
    expect(screen.getAllByText('生产服务器')).toHaveLength(2)
    expect(screen.getAllByText('测试服务器')).toHaveLength(2)
  })
})

function session(id: string, name: string, folderId: string) {
  return { id, name, host: '192.168.1.48', port: 22, username: 'root', authMethod: 'password' as const, keepAlive: 30, termType: 'xterm-256color', folderId, connectionCount: 0 }
}
