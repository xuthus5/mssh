import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandHistoryPanel } from '@/components/terminal/CommandHistoryPanel'
import { useToastStore } from '@/components/ui/toast'
import { recordCommand } from '@/lib/commandHistory'

const { listHistory } = vi.hoisted(() => ({
  listHistory: vi.fn(async () => [{ id: 1, command: 'git status' }, { id: 2, command: 'npm test' }]),
}))
vi.mock('@/lib/wails', () => ({ CommandHistoryService: { List: listHistory } }))

describe('CommandHistoryPanel', () => {
  beforeEach(() => {
    localStorage.clear()
    listHistory.mockClear()
    useToastStore.setState({ toasts: [] })
  })

  it('searches and fills a stored command', async () => {
    recordCommand(1, 'git status')
    recordCommand(1, 'npm test')
    const onFill = vi.fn()
    render(<CommandHistoryPanel sessionID={1} onClose={vi.fn()} onFill={onFill} />)
    await userEvent.type(screen.getByPlaceholderText('搜索历史命令...'), 'git')
    expect(screen.getByText('git status')).toBeInTheDocument()
    expect(screen.queryByText('npm test')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '填入终端' }))
    expect(onFill).toHaveBeenCalledWith('git status')
  })

  it('uses localStorage only for non-positive session buckets', async () => {
    recordCommand(-1, 'echo local')
    render(<CommandHistoryPanel sessionID={-1} onClose={vi.fn()} onFill={vi.fn()} />)
    expect(await screen.findByText('echo local')).toBeInTheDocument()
    expect(listHistory).not.toHaveBeenCalled()
  })

  it('toasts remote history list failures', async () => {
    listHistory.mockRejectedValueOnce(new Error('history list failed'))
    render(<CommandHistoryPanel sessionID={9} onClose={vi.fn()} onFill={vi.fn()} />)
    await waitFor(() => expect(useToastStore.getState().toasts.some((item) => item.message.includes('history list failed'))).toBe(true))
  })
})
