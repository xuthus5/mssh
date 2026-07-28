import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

const impacts = vi.hoisted(() => ({
  environment: vi.fn(async () => ({ id: 1, name: '生产', session_count: 2 })),
  project: vi.fn(async () => ({ id: 1, name: '支付', session_count: 1 })),
  tag: vi.fn(async () => ({ id: 3, name: '核心', session_count: 4 })),
}))
const toast = vi.hoisted(() => vi.fn())
vi.mock('@/components/ui/toast', () => ({ toast }))
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

  it('shows reorder failures inline without error toast', async () => {
    const values = props()
    values.onReorderEnvironments = vi.fn(async () => { throw new Error('reorder failed') })
    render(<SessionAssetCatalogManager {...values} />)
    await userEvent.click(screen.getByRole('button', { name: '下移 生产' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('调整资产排序失败: reorder failed'))
    expect(toast).not.toHaveBeenCalled()
  })

  it('allows only one reorder request for a catalog target', async () => {
    let resolveReorder: (() => void) | undefined
    const values = props()
    values.onReorderEnvironments = vi.fn(() => new Promise<void>((resolve) => { resolveReorder = resolve }))
    render(<SessionAssetCatalogManager {...values} />)

    const moveButton = screen.getByRole('button', { name: '下移 生产' })
    act(() => {
      fireEvent.click(moveButton)
      fireEvent.click(moveButton)
    })
    expect(moveButton).toBeDisabled()
    expect(values.onReorderEnvironments).toHaveBeenCalledOnce()
    await act(async () => { resolveReorder?.() })
    expect(moveButton).toBeEnabled()
  })

  it('does not show an old reorder error after the catalog target changes', async () => {
    let rejectReorder: ((reason: Error) => void) | undefined
    const values = props()
    values.onReorderEnvironments = vi.fn(() => new Promise<void>((_, reject) => { rejectReorder = reject }))
    const view = render(<SessionAssetCatalogManager {...values} />)
    await userEvent.click(screen.getByRole('button', { name: '下移 生产' }))
    view.rerender(<SessionAssetCatalogManager {...values} environments={[{ ...values.environments[0], id: 'new', name: '新环境' }]} />)
    await act(async () => { rejectReorder?.(new Error('old reorder failed')) })
    expect(screen.queryByText('调整资产排序失败: old reorder failed')).not.toBeInTheDocument()
  })

  it('keeps the reorder lease while refreshed catalog data replaces the visible target', async () => {
    let resolveReorder: (() => void) | undefined
    const values = props()
    values.onReorderEnvironments = vi.fn(() => new Promise<void>((resolve) => { resolveReorder = resolve }))
    const view = render(<SessionAssetCatalogManager {...values} />)
    await userEvent.click(screen.getByRole('button', { name: '下移 生产' }))

    const refreshed = [
      { ...values.environments[0], id: 'new-1', name: '新环境' },
      { ...values.environments[1], id: 'new-2', name: '新测试' },
    ]
    view.rerender(<SessionAssetCatalogManager {...values} environments={refreshed} />)
    const refreshedMove = screen.getByRole('button', { name: '下移 新环境' })
    expect(refreshedMove).toBeDisabled()
    await userEvent.click(refreshedMove)
    expect(values.onReorderEnvironments).toHaveBeenCalledOnce()

    await act(async () => { resolveReorder?.() })
    await waitFor(() => expect(refreshedMove).toBeEnabled())
    await userEvent.click(refreshedMove)
    expect(values.onReorderEnvironments).toHaveBeenLastCalledWith(['new-2', 'new-1'])
  })

  it('blocks catalog create, edit, and delete while reorder is pending', async () => {
    const reorder = deferred<void>()
    const values = props()
    values.onReorderEnvironments = vi.fn(() => reorder.promise)
    render(<SessionAssetCatalogManager {...values} />)

    fireEvent.click(screen.getByRole('button', { name: '下移 生产' }))
    const createButton = screen.getByRole('button', { name: '新建环境' })
    const rowActions = screen.getByRole('button', { name: '生产 分类操作' })
    expect(createButton).toBeDisabled()
    expect(rowActions).toBeDisabled()

    fireEvent.click(createButton)
    fireEvent.click(rowActions)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await act(async () => reorder.resolve())
    await waitFor(() => expect(createButton).toBeEnabled())
    expect(rowActions).toBeEnabled()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
