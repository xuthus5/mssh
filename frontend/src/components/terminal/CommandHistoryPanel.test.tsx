import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandHistoryPanel } from '@/components/terminal/CommandHistoryPanel'
import { recordCommand } from '@/lib/commandHistory'

describe('CommandHistoryPanel', () => {
  beforeEach(() => localStorage.clear())
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
})
