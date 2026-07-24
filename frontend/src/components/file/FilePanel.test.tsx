import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import FilePanel from '@/components/file/FilePanel'

const handlers = {
  onClose: vi.fn(), onNavigateTo: vi.fn(), onNavigateUp: vi.fn(), onDelete: vi.fn(),
  onRename: vi.fn(), onMakeDir: vi.fn(), onUpload: vi.fn(), onDownload: vi.fn(),
  onLoadDirectory: vi.fn(async () => []),
  onSyncCurrentDirectory: vi.fn(), syncingCurrentDirectory: false,
}

describe('FilePanel SFTP views', () => {
  it('filters hidden files and switches between list and tree views', async () => {
    const user = userEvent.setup()
    render(<FilePanel open files={[
      { name: '.env', path: '/.env', size: 10, modified: '', isDir: false },
      { name: 'src', path: '/src', size: 0, modified: '', isDir: true },
    ]} currentPath="/" loading={false} dropTargetId="drop-zone" showHiddenFiles={false} defaultView="list" {...handlers} />)

    expect(screen.queryByText('.env')).not.toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '同步当前目录' }))
    expect(handlers.onSyncCurrentDirectory).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: '树状视图' }))
    expect(screen.getByRole('tree', { name: '远程文件树' })).toBeInTheDocument()
    expect(screen.queryByText('.env')).not.toBeInTheDocument()
  })

  it('uses the configured tree view and shows hidden files', () => {
    render(<FilePanel open files={[
      { name: '.ssh', path: '/.ssh', size: 0, modified: '', isDir: true },
    ]} currentPath="/" loading={false} dropTargetId="drop-zone" showHiddenFiles defaultView="tree" {...handlers} />)

    expect(screen.getByRole('tree', { name: '远程文件树' })).toBeInTheDocument()
    expect(screen.getByText('.ssh')).toBeInTheDocument()
  })
})

  it('surfaces delete failures panel-owned without toast', async () => {
    const { useToastStore } = await import('@/components/ui/toast')
    useToastStore.setState({ toasts: [] })
    const onDelete = vi.fn(async () => { throw new Error('delete boom') })
    const user = userEvent.setup()
    render(<FilePanel open files={[
      { name: 'a.txt', path: '/a.txt', size: 1, modified: '', isDir: false },
    ]} currentPath="/" loading={false} dropTargetId="drop-zone" showHiddenFiles defaultView="list" {...handlers} onDelete={onDelete} />)
    await user.click(screen.getByText('a.txt'))
    await user.click(screen.getByRole('button', { name: '删除' }))
    await user.click(screen.getByRole('button', { name: '删除' }))
    expect(await screen.findByText('删除文件失败: delete boom')).toBeInTheDocument()
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })

  it('surfaces mkdir failures panel-owned without toast', async () => {
    const { useToastStore } = await import('@/components/ui/toast')
    useToastStore.setState({ toasts: [] })
    const onMakeDir = vi.fn(async () => { throw new Error('mkdir boom') })
    const user = userEvent.setup()
    render(<FilePanel open files={[]} currentPath="/" loading={false} dropTargetId="drop-zone" showHiddenFiles={false} defaultView="list" {...handlers} onMakeDir={onMakeDir} />)
    await user.click(screen.getByRole('button', { name: '新建文件夹' }))
    await user.type(screen.getByPlaceholderText('文件夹名'), 'logs')
    await user.click(screen.getByRole('button', { name: '确定' }))
    expect(await screen.findByText('创建目录失败: mkdir boom')).toBeInTheDocument()
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })

  it('shows external actionError banner', () => {
    render(<FilePanel open files={[]} currentPath="/" loading={false} dropTargetId="drop-zone" showHiddenFiles={false} defaultView="list" actionError="选择上传文件失败: picker unavailable" {...handlers} />)
    expect(screen.getByText('选择上传文件失败: picker unavailable')).toBeInTheDocument()
  })

