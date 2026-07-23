import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandHistoryPanel } from '@/components/terminal/CommandHistoryPanel'
import { useToastStore } from '@/components/ui/toast'
import { recordCommand, readCommandHistory } from '@/lib/commandHistory'
import { requestConfirm } from '@/lib/confirmDialog'

const { listHistory, clearHistory } = vi.hoisted(() => ({
  listHistory: vi.fn(async () => [{ id: 1, command: 'git status' }, { id: 2, command: 'npm test' }]),
  clearHistory: vi.fn(async () => {}),
}))
vi.mock('@/lib/wails', () => ({ CommandHistoryService: { List: listHistory, Clear: clearHistory, Add: vi.fn(async () => null) } }))
vi.mock('@/lib/confirmDialog', () => ({ requestConfirm: vi.fn(async () => true) }))

describe('CommandHistoryPanel', () => {
  beforeEach(() => {
    localStorage.clear()
    listHistory.mockReset()
    clearHistory.mockReset()
    listHistory.mockResolvedValue([{ id: 1, command: 'git status' }, { id: 2, command: 'npm test' }])
    clearHistory.mockResolvedValue(undefined)
    vi.mocked(requestConfirm).mockResolvedValue(true)
    useToastStore.setState({ toasts: [] })
  })

  it('searches and fills a stored command', async () => {
    const onFill = vi.fn()
    render(<CommandHistoryPanel sessionID={1} onClose={vi.fn()} onFill={onFill} />)
    expect(await screen.findByText('git status')).toBeInTheDocument()
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

  it('shows remote history list failures inline without toast', async () => {
    listHistory.mockRejectedValueOnce(new Error('history list failed'))
    render(<CommandHistoryPanel sessionID={9} onClose={vi.fn()} onFill={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('history list failed')
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('clears remote and local history after confirmation', async () => {
    localStorage.setItem('mssh:command-history:3', JSON.stringify([{ id: 'x', command: 'local leftover', createdAt: 1 }]))
    render(<CommandHistoryPanel sessionID={3} onClose={vi.fn()} onFill={vi.fn()} />)
    expect(await screen.findByText('git status')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '清空历史' }))
    await waitFor(() => expect(requestConfirm).toHaveBeenCalled())
    await waitFor(() => expect(clearHistory).toHaveBeenCalledWith(3))
    expect(readCommandHistory(3)).toEqual([])
    await waitFor(() => expect(useToastStore.getState().toasts.some((item) => item.message.includes('已清空'))).toBe(true))
    expect(screen.queryByText('git status')).not.toBeInTheDocument()
  })

  it('does not clear when confirmation is cancelled', async () => {
    vi.mocked(requestConfirm).mockResolvedValueOnce(false)
    render(<CommandHistoryPanel sessionID={4} onClose={vi.fn()} onFill={vi.fn()} />)
    expect(await screen.findByText('git status')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '清空历史' }))
    await waitFor(() => expect(requestConfirm).toHaveBeenCalled())
    expect(clearHistory).not.toHaveBeenCalled()
    expect(screen.getByText('git status')).toBeInTheDocument()
  })

  it('surfaces remote clear failures inline and keeps history', async () => {
    clearHistory.mockRejectedValueOnce(new Error('clear failed'))
    render(<CommandHistoryPanel sessionID={5} onClose={vi.fn()} onFill={vi.fn()} />)
    expect(await screen.findByText('git status')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '清空历史' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('清空命令历史失败: clear failed')
    expect(screen.getByText('git status')).toBeInTheDocument()
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })

  it('surfaces copy failures panel-owned without toast', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => { throw new Error('clipboard unavailable') }) },
    })
    render(<CommandHistoryPanel sessionID={5} onClose={vi.fn()} onFill={vi.fn()} />)
    expect(await screen.findByText('git status')).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: '复制' })[0])
    expect(await screen.findByRole('alert')).toHaveTextContent('复制失败: clipboard unavailable')
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })
})
