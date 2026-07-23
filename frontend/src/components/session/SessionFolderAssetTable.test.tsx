import { render, screen, waitFor } from '@testing-library/react'
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
    expect(useToastStore.getState().toasts).toHaveLength(0)
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
    expect(await screen.findByText('delete boom')).toBeInTheDocument()
    expect(useToastStore.getState().toasts.some((item) => item.message.includes('delete boom'))).toBe(false)
  })
})
