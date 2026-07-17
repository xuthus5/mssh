import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

const impacts = vi.hoisted(() => ({
  environment: vi.fn(async () => ({ id: 1, name: '生产', session_count: 2 })),
  project: vi.fn(async () => ({ id: 1, name: '支付', session_count: 1 })),
  tag: vi.fn(async () => ({ id: 3, name: '核心', session_count: 4 })),
}))
vi.mock('@/lib/wails', () => ({ AssetCatalogService: { EnvironmentDeleteImpact: impacts.environment, ProjectDeleteImpact: impacts.project, TagDeleteImpact: impacts.tag } }))

import { SessionAssetCatalogManager } from '@/components/session/SessionAssetCatalogManager'

function props() {
  return {
    environments: [
      { id: '1', name: '生产', colorToken: 'red' as const, sortOrder: 0, sessionCount: 2 },
      { id: '2', name: '测试', colorToken: 'amber' as const, sortOrder: 1, sessionCount: 0 },
    ], projects: [], tags: [{ id: '3', name: '核心', colorToken: 'blue' as const, sessionCount: 4 }],
    onCreateEnvironment: vi.fn(async (name: string) => ({ id: '4', name, colorToken: 'slate' as const, sortOrder: 2, sessionCount: 0 })),
    onCreateProject: vi.fn(), onCreateTag: vi.fn(), onUpdateEnvironment: vi.fn(), onUpdateProject: vi.fn(), onUpdateTag: vi.fn(),
    onDeleteEnvironment: vi.fn(), onDeleteProject: vi.fn(), onDeleteTag: vi.fn(async () => {}),
    onReorderEnvironments: vi.fn(async () => {}), onReorderProjects: vi.fn(async () => {}),
  }
}

describe('SessionAssetCatalogManager', () => {
  it('creates and reorders catalog entries', async () => {
    const values = props()
    render(<SessionAssetCatalogManager {...values} />)
    await userEvent.click(screen.getByRole('button', { name: '下移 生产' }))
    expect(values.onReorderEnvironments).toHaveBeenCalledWith(['2', '1'])
    await userEvent.click(screen.getByRole('button', { name: '新建环境' }))
    await userEvent.type(screen.getByRole('textbox', { name: '名称' }), '预发')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(values.onCreateEnvironment).toHaveBeenCalledWith('预发', 'slate')
  })

  it('shows tag impact and requires confirmation before deletion', async () => {
    const values = props()
    render(<SessionAssetCatalogManager {...values} />)
    await userEvent.click(screen.getByRole('tab', { name: /标签/ }))
    await userEvent.click(screen.getByRole('button', { name: '核心 分类操作' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: '删除' }))
    expect(await screen.findByText('当前关联 4 个会话。')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '确认处理 4 个会话并删除' }))
    await waitFor(() => expect(values.onDeleteTag).toHaveBeenCalledWith('3'))
  })

  it('requires environment migration or explicit clearing', async () => {
    const values = props()
    render(<SessionAssetCatalogManager {...values} />)
    await userEvent.click(screen.getByRole('button', { name: '生产 分类操作' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: '删除' }))
    expect(await screen.findByText('当前关联 2 个会话。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认处理 2 个会话并删除' })).toBeDisabled()
    await userEvent.click(screen.getByRole('combobox', { name: '迁移目标' }))
    await userEvent.click(await screen.findByRole('option', { name: '测试' }))
    await userEvent.click(screen.getByRole('button', { name: '确认处理 2 个会话并删除' }))
    await waitFor(() => expect(values.onDeleteEnvironment).toHaveBeenCalledWith('1', 'migrate', '2'))
  })
})
