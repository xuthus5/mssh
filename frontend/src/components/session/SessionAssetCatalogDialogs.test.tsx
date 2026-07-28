import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionAssetCatalogDeleteDialog, SessionAssetCatalogEditor } from '@/components/session/SessionAssetCatalogDialogs'
import { useToastStore } from '@/components/ui/toast'

const environmentImpact = vi.fn()
const tagImpact = vi.fn()
vi.mock('@/lib/wails', () => ({
  AssetCatalogService: {
    EnvironmentDeleteImpact: (...args: unknown[]) => environmentImpact(...args),
    ProjectDeleteImpact: vi.fn(),
    TagDeleteImpact: (...args: unknown[]) => tagImpact(...args),
  },
}))

describe('SessionAssetCatalogDialogs', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    environmentImpact.mockReset()
    tagImpact.mockReset()
    environmentImpact.mockResolvedValue({ name: '生产', session_count: 1 })
    tagImpact.mockResolvedValue({ name: '核心', session_count: 2 })
  })

  it('shows catalog save failures inline without toast', async () => {
    const onCreateEnvironment = vi.fn(async () => {
      throw new Error('save catalog failed')
    })
    render(
      <SessionAssetCatalogEditor
        target={{ kind: 'environment' }}
        onOpenChange={vi.fn()}
        onCreateEnvironment={onCreateEnvironment}
        onCreateProject={vi.fn()}
        onCreateTag={vi.fn()}
        onUpdateEnvironment={vi.fn()}
        onUpdateProject={vi.fn()}
        onUpdateTag={vi.fn()}
      />,
    )
    await userEvent.type(screen.getByRole('textbox'), '生产')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('save catalog failed')
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('deduplicates rapid catalog saves', async () => {
    const pending = deferred<{ id: string; name: string; colorToken: 'red'; sortOrder: number; sessionCount: number }>()
    const onCreateEnvironment = vi.fn(() => pending.promise)
    render(
      <SessionAssetCatalogEditor
        target={{ kind: 'environment' }}
        onOpenChange={vi.fn()}
        onCreateEnvironment={onCreateEnvironment}
        onCreateProject={vi.fn()}
        onCreateTag={vi.fn()}
        onUpdateEnvironment={vi.fn()}
        onUpdateProject={vi.fn()}
        onUpdateTag={vi.fn()}
      />,
    )
    await userEvent.type(screen.getByRole('textbox'), '生产')
    const save = screen.getByRole('button', { name: '保存' })
    act(() => {
      fireEvent.click(save)
      fireEvent.click(save)
    })
    expect(onCreateEnvironment).toHaveBeenCalledOnce()
    await act(async () => pending.resolve({ id: '1', name: '生产', colorToken: 'red', sortOrder: 0, sessionCount: 0 }))
  })

  it('keeps the editor open when dismissal is requested during save', async () => {
    const pending = deferred<{ id: string; name: string; colorToken: 'red'; sortOrder: number; sessionCount: number }>()
    const onOpenChange = vi.fn()
    render(
      <SessionAssetCatalogEditor
        target={{ kind: 'environment' }}
        onOpenChange={onOpenChange}
        onCreateEnvironment={vi.fn(() => pending.promise)}
        onCreateProject={vi.fn()}
        onCreateTag={vi.fn()}
        onUpdateEnvironment={vi.fn()}
        onUpdateProject={vi.fn()}
        onUpdateTag={vi.fn()}
      />,
    )
    await userEvent.type(screen.getByRole('textbox'), '生产')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    await act(async () => pending.resolve({ id: '1', name: '生产', colorToken: 'red', sortOrder: 0, sessionCount: 0 }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('shows delete impact load failures inline without toast', async () => {
    environmentImpact.mockRejectedValueOnce(new Error('impact failed'))
    render(
      <SessionAssetCatalogDeleteDialog
        target={{ kind: 'environment', item: { id: '1', name: '生产', colorToken: 'red', sortOrder: 0, sessionCount: 1 } }}
        environments={[{ id: '1', name: '生产', colorToken: 'red', sortOrder: 0, sessionCount: 1 }]}
        projects={[]}
        onOpenChange={vi.fn()}
        onDeleteEnvironment={vi.fn()}
        onDeleteProject={vi.fn()}
        onDeleteTag={vi.fn()}
      />,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('impact failed')
    expect(screen.getByText('关联会话分析失败，请重试。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /确认处理 0/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('当前关联 1 个会话。')).toBeInTheDocument()
    expect(environmentImpact).toHaveBeenCalledTimes(2)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('shows delete failures for tags inline without toast', async () => {
    const onDeleteTag = vi.fn(async () => {
      throw new Error('delete failed')
    })
    render(
      <SessionAssetCatalogDeleteDialog
        target={{ kind: 'tag', item: { id: '9', name: '核心', colorToken: 'red', sessionCount: 2 } }}
        environments={[]}
        projects={[]}
        onOpenChange={vi.fn()}
        onDeleteEnvironment={vi.fn()}
        onDeleteProject={vi.fn()}
        onDeleteTag={onDeleteTag}
      />,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: /确认处理/ })).not.toBeDisabled())
    await userEvent.click(screen.getByRole('button', { name: /确认处理/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('delete failed')
    expect(screen.getByText('当前关联 2 个会话。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认处理 2 个会话并删除' })).toBeEnabled()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('deduplicates rapid catalog delete confirmations', async () => {
    const pending = deferred<void>()
    const onDeleteTag = vi.fn(() => pending.promise)
    const onOpenChange = vi.fn()
    render(
      <SessionAssetCatalogDeleteDialog
        target={{ kind: 'tag', item: { id: '9', name: '核心', colorToken: 'red', sessionCount: 2 } }}
        environments={[]}
        projects={[]}
        onOpenChange={onOpenChange}
        onDeleteEnvironment={vi.fn()}
        onDeleteProject={vi.fn()}
        onDeleteTag={onDeleteTag}
      />,
    )
    const confirm = await screen.findByRole('button', { name: /确认处理/ })
    await waitFor(() => expect(confirm).toBeEnabled())
    act(() => {
      fireEvent.click(confirm)
      fireEvent.click(confirm)
    })
    expect(onDeleteTag).toHaveBeenCalledOnce()
    await act(async () => pending.resolve())
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('does not close a new editor when an old save resolves', async () => {
    let resolveSave: (() => void) | undefined
    const onOpenChange = vi.fn()
    const onUpdateEnvironment = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve }))
    const first = { id: '1', name: '旧环境', colorToken: 'red' as const, sortOrder: 0, sessionCount: 1 }
    const second = { id: '2', name: '新环境', colorToken: 'blue' as const, sortOrder: 1, sessionCount: 0 }
    const view = render(
      <SessionAssetCatalogEditor
        target={{ kind: 'environment', item: first }}
        onOpenChange={onOpenChange}
        onCreateEnvironment={vi.fn()}
        onCreateProject={vi.fn()}
        onCreateTag={vi.fn()}
        onUpdateEnvironment={onUpdateEnvironment}
        onUpdateProject={vi.fn()}
        onUpdateTag={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    view.rerender(
      <SessionAssetCatalogEditor
        target={{ kind: 'environment', item: second }}
        onOpenChange={onOpenChange}
        onCreateEnvironment={vi.fn()}
        onCreateProject={vi.fn()}
        onCreateTag={vi.fn()}
        onUpdateEnvironment={onUpdateEnvironment}
        onUpdateProject={vi.fn()}
        onUpdateTag={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '保存中…' }))
    expect(onUpdateEnvironment).toHaveBeenCalledOnce()
    await act(async () => {
      resolveSave?.()
      await Promise.resolve()
    })
    expect(screen.getByLabelText('名称')).toHaveValue('新环境')
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('ignores old delete impact and failure results after target changes', async () => {
    const firstImpact = new Promise<{ name: string; session_count: number }>(() => {})
    let rejectDelete: ((reason?: unknown) => void) | undefined
    const secondImpact = vi.fn(async () => ({ name: '新标签', session_count: 2 }))
    tagImpact.mockImplementationOnce(() => firstImpact).mockImplementationOnce(secondImpact)
    const onDeleteTag = vi.fn(() => new Promise<void>((_, reject) => { rejectDelete = reject }))
    const first = { kind: 'tag' as const, item: { id: '1', name: '旧标签', colorToken: 'red' as const, sessionCount: 1 } }
    const second = { kind: 'tag' as const, item: { id: '2', name: '新标签', colorToken: 'blue' as const, sessionCount: 2 } }
    const view = render(
      <SessionAssetCatalogDeleteDialog
        target={first}
        environments={[]}
        projects={[]}
        onOpenChange={vi.fn()}
        onDeleteEnvironment={vi.fn()}
        onDeleteProject={vi.fn()}
        onDeleteTag={onDeleteTag}
      />,
    )
    view.rerender(
      <SessionAssetCatalogDeleteDialog
        target={second}
        environments={[]}
        projects={[]}
        onOpenChange={vi.fn()}
        onDeleteEnvironment={vi.fn()}
        onDeleteProject={vi.fn()}
        onDeleteTag={onDeleteTag}
      />,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: /确认处理/ })).not.toBeDisabled())
    await userEvent.click(screen.getByRole('button', { name: /确认处理/ }))
    view.rerender(
      <SessionAssetCatalogDeleteDialog
        target={{ kind: 'tag', item: { id: '3', name: '当前标签', colorToken: 'green', sessionCount: 0 } }}
        environments={[]}
        projects={[]}
        onOpenChange={vi.fn()}
        onDeleteEnvironment={vi.fn()}
        onDeleteProject={vi.fn()}
        onDeleteTag={onDeleteTag}
      />,
    )
    expect(screen.getByRole('button', { name: '删除中…' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '删除中…' }))
    expect(onDeleteTag).toHaveBeenCalledOnce()
    await act(async () => {
      rejectDelete?.(new Error('old delete failed'))
      await Promise.resolve()
    })
    expect(screen.getByText('删除“当前标签”？')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: /确认处理/ })).toBeEnabled())
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
