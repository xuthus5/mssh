import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionAssetDeleteDialog } from '@/components/session/SessionFolderAssetTable'
import { useToastStore } from '@/components/ui/toast'

const impact = vi.fn()
vi.mock('@/lib/wails', () => ({
  SessionService: {
    SessionDeleteImpact: (...args: unknown[]) => impact(...args),
  },
}))

describe('SessionAssetDeleteDialog', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    impact.mockReset()
    impact.mockResolvedValue({ tunnels: 1, history: 2, recordings: 3, transfers: 0 })
  })

  it('shows impact load failures inline without toast', async () => {
    impact.mockRejectedValueOnce(new Error('impact boom'))
    render(
      <SessionAssetDeleteDialog
        target={{ type: 'session', item: { id: '1', name: 's1', host: 'h', port: 22, username: 'u', tags: [], notes: '', authMethod: 'password', folderId: null } as never }}
        folders={[]}
        sessions={[]}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('impact boom')
    expect(screen.getByText('分析关联资产影响失败，影响范围未知。仍可继续删除。')).toBeInTheDocument()
    expect(screen.queryByText('正在分析关联资产影响范围。')).not.toBeInTheDocument()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('clears old impact immediately when the session target changes', async () => {
    let resolveSecond: ((value: { tunnels: number; history: number; recordings: number; transfers: number }) => void) | undefined
    impact
      .mockResolvedValueOnce({ tunnels: 7, history: 8, recordings: 9, transfers: 10 })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve }))
    const target = (id: string, name: string) => ({ type: 'session' as const, item: { id, name, host: 'h', port: 22, username: 'u', tags: [], notes: '', authMethod: 'password', folderId: null } as never })
    const props = { folders: [], sessions: [], onOpenChange: vi.fn(), onConfirm: vi.fn() }
    const view = render(<SessionAssetDeleteDialog target={target('1', '旧会话')} {...props} />)

    expect(await screen.findByText('将同时影响 7 条隧道、8 条命令历史、9 条录制记录和 10 个进行中传输。')).toBeInTheDocument()
    view.rerender(<SessionAssetDeleteDialog target={target('2', '新会话')} {...props} />)

    expect(screen.getByText('正在分析关联资产影响范围。')).toBeInTheDocument()
    expect(screen.queryByText(/将同时影响 7 条隧道/)).not.toBeInTheDocument()
    await act(async () => resolveSecond?.({ tunnels: 1, history: 2, recordings: 3, transfers: 4 }))
    expect(screen.getByText('将同时影响 1 条隧道、2 条命令历史、3 条录制记录和 4 个进行中传输。')).toBeInTheDocument()
  })

  it('keeps inline delete failures without local toast', async () => {
    const onConfirm = vi.fn(async () => { throw new Error('delete boom') })
    render(
      <SessionAssetDeleteDialog
        target={{ type: 'folder', item: { id: '1', name: '默认分组', parentId: null, isDefault: false } }}
        folders={[{ id: '1', name: '默认分组', parentId: null, isDefault: false }, { id: '2', name: '其他', parentId: null, isDefault: true }]}
        sessions={[]}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '确认删除' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('删除分组失败: delete boom')
    expect(useToastStore.getState().toasts.some((item) => item.message.includes('delete boom'))).toBe(false)
  })

  it('keeps the delete lease while isolating an old failure after target changes', async () => {
    let rejectDelete: ((reason?: unknown) => void) | undefined
    const onConfirm = vi.fn(() => new Promise<void>((_, reject) => { rejectDelete = reject }))
    const first = { type: 'folder' as const, item: { id: '1', name: '旧分组', parentId: null, isDefault: false } }
    const second = { type: 'folder' as const, item: { id: '2', name: '新分组', parentId: null, isDefault: false } }
    const view = render(
      <SessionAssetDeleteDialog
        target={first}
        folders={[first.item, second.item]}
        sessions={[]}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '确认删除' }))
    view.rerender(
      <SessionAssetDeleteDialog
        target={second}
        folders={[first.item, second.item]}
        sessions={[]}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    )
    expect(screen.getByRole('button', { name: '删除中…' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '删除中…' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    await act(async () => {
      rejectDelete?.(new Error('old delete failed'))
      await Promise.resolve()
    })
    expect(screen.getByText('删除“新分组”？')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认删除' })).toBeEnabled()
  })

  it('prevents duplicate delete confirmation submissions', async () => {
    let resolveDelete: (() => void) | undefined
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => { resolveDelete = resolve }))
    render(
      <SessionAssetDeleteDialog
        target={{ type: 'folder', item: { id: '1', name: '分组', parentId: null, isDefault: false } }}
        folders={[]}
        sessions={[]}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '确认删除' }))
    const pending = screen.getByRole('button', { name: '删除中…' })
    expect(pending).toBeDisabled()
    await userEvent.click(pending)
    expect(onConfirm).toHaveBeenCalledOnce()
    await act(async () => { resolveDelete?.() })
  })
})
