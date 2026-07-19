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
