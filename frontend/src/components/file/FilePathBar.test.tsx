import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FilePathBar } from '@/components/file/FilePathBar'

describe('FilePathBar', () => {
  it('edits and normalizes a directory path', async () => {
    const user = userEvent.setup()
    const onNavigateTo = vi.fn()
    const view = render(<FilePathBar currentPath="/srv" onNavigateUp={vi.fn()} onNavigateTo={onNavigateTo} />)

    await user.click(screen.getByRole('button', { name: '编辑路径' }))
    const input = screen.getByRole('textbox', { name: '目录路径' })
    expect(input).toHaveValue('/srv')

    await user.clear(input)
    await user.type(input, '/var/./log/../logs/')
    await user.click(screen.getByRole('button', { name: '前往' }))

    expect(onNavigateTo).toHaveBeenCalledWith('/var/logs')
    expect(screen.getByRole('button', { name: '编辑路径' })).toBeInTheDocument()

    view.rerender(<FilePathBar currentPath="/var/logs" onNavigateUp={vi.fn()} onNavigateTo={onNavigateTo} />)
    await user.click(screen.getByRole('button', { name: '编辑路径' }))
    expect(screen.getByRole('textbox', { name: '目录路径' })).toHaveValue('/var/logs')
  })

  it('rejects empty and relative paths without navigating', async () => {
    const user = userEvent.setup()
    const onNavigateTo = vi.fn()
    render(<FilePathBar currentPath="/srv" onNavigateUp={vi.fn()} onNavigateTo={onNavigateTo} />)

    await user.click(screen.getByRole('button', { name: '编辑路径' }))
    const input = screen.getByRole('textbox', { name: '目录路径' })
    await user.clear(input)
    await user.click(screen.getByRole('button', { name: '前往' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请输入目录路径')

    await user.type(input, 'var/log')
    await user.click(screen.getByRole('button', { name: '前往' }))
    expect(screen.getByRole('alert')).toHaveTextContent('目录路径必须以 / 开头')
    expect(onNavigateTo).not.toHaveBeenCalled()
  })

  it('cancels editing with Escape and the cancel button', async () => {
    const user = userEvent.setup()
    const onNavigateTo = vi.fn()
    render(<FilePathBar currentPath="/srv" onNavigateUp={vi.fn()} onNavigateTo={onNavigateTo} />)

    await user.click(screen.getByRole('button', { name: '编辑路径' }))
    await user.type(screen.getByRole('textbox', { name: '目录路径' }), '/changed')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: '编辑路径' })).toBeInTheDocument()
    expect(onNavigateTo).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '编辑路径' }))
    expect(screen.getByRole('textbox', { name: '目录路径' })).toHaveValue('/srv')
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByRole('button', { name: '编辑路径' })).toBeInTheDocument()
  })
})
