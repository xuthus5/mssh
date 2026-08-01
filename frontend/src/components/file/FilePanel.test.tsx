import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import FilePanel from '@/components/file/FilePanel'

const handlers = {
  onClose: vi.fn(), onNavigateTo: vi.fn(), onNavigateUp: vi.fn(), onDelete: vi.fn(),
  onRename: vi.fn(), onMakeDir: vi.fn(), onUpload: vi.fn(), onDownload: vi.fn(),
  onLoadDirectory: vi.fn(async () => []),
  transferActionPending: null, onSyncCurrentDirectory: vi.fn(), syncingCurrentDirectory: false,
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
    expect(screen.queryByRole('button', { name: '安装自动跟随脚本' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '树状视图' }))
    expect(screen.getByRole('tree', { name: '远程文件树' })).toBeInTheDocument()
    expect(screen.queryByText('.env')).not.toBeInTheDocument()
  })

  it('hides the sync-current-directory button while OSC 7 follows the terminal', () => {
    render(<FilePanel open files={[]} currentPath="/" loading={false} dropTargetId="drop-zone" showHiddenFiles={false}
      defaultView="list" {...handlers} followsTerminalDirectory />)
    expect(screen.queryByRole('button', { name: '同步当前目录' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument()
  })

  it('uses the configured tree view and shows hidden files', () => {
    render(<FilePanel open files={[
      { name: '.ssh', path: '/.ssh', size: 0, modified: '', isDir: true },
    ]} currentPath="/" loading={false} dropTargetId="drop-zone" showHiddenFiles defaultView="tree" {...handlers} />)

    expect(screen.getByRole('tree', { name: '远程文件树' })).toBeInTheDocument()
    expect(screen.getByText('.ssh')).toBeInTheDocument()
  })

  it('keeps delete confirm open and shows inline failure without toast', async () => {
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
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
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

  it('keeps the mkdir lease across panel and path changes', async () => {
    const pending = deferred<void>()
    const onMakeDir = vi.fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(undefined)
    const props = { open: true, files: [], currentPath: '/', loading: false, dropTargetId: 'drop-zone', showHiddenFiles: false, defaultView: 'list' as const, ...handlers, onMakeDir }
    const view = render(<FilePanel {...props} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '新建文件夹' }))
    await user.type(screen.getByPlaceholderText('文件夹名'), 'old')
    await user.click(screen.getByRole('button', { name: '确定' }))
    view.rerender(<FilePanel {...props} open={false} />)
    view.rerender(<FilePanel {...props} open currentPath="/next" />)

    expect(screen.getByPlaceholderText('文件夹名')).toBeDisabled()
    expect(screen.getByRole('button', { name: '确定' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '新建文件夹' })).toBeDisabled()
    await act(async () => pending.resolve())

    await user.type(screen.getByPlaceholderText('文件夹名'), 'new')
    await user.click(screen.getByRole('button', { name: '确定' }))
    expect(onMakeDir).toHaveBeenNthCalledWith(2, 'new')
  })

  it('keeps the rename lease across panel changes and blocks closing', async () => {
    const pending = deferred<void>()
    const onRename = vi.fn(() => pending.promise)
    const props = { open: true, files: [{ name: 'a.txt', path: '/a.txt', size: 1, modified: '', isDir: false }], currentPath: '/', loading: false, dropTargetId: 'drop-zone', showHiddenFiles: false, defaultView: 'list' as const, ...handlers, onRename }
    const view = render(<FilePanel {...props} />)
    const user = userEvent.setup()
    await user.click(screen.getByText('a.txt'))
    await user.click(screen.getByRole('button', { name: '重命名' }))
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    expect(screen.getByRole('textbox')).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    view.rerender(<FilePanel {...props} open={false} />)
    view.rerender(<FilePanel {...props} open />)
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    await act(async () => pending.resolve())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
  })

  it('deduplicates rapid mkdir submissions', async () => {
    const pending = deferred<void>()
    const onMakeDir = vi.fn(() => pending.promise)
    render(<FilePanel open files={[]} currentPath="/" loading={false} dropTargetId="drop-zone" showHiddenFiles={false} defaultView="list" {...handlers} onMakeDir={onMakeDir} />)
    await userEvent.click(screen.getByRole('button', { name: '新建文件夹' }))
    await userEvent.type(screen.getByPlaceholderText('文件夹名'), 'logs')
    const submit = screen.getByRole('button', { name: '确定' })
    act(() => {
      fireEvent.click(submit)
      fireEvent.click(submit)
    })
    expect(onMakeDir).toHaveBeenCalledOnce()
    await act(async () => pending.resolve())
  })

  it('disables directory writes during an external lease without trapping the panel', () => {
    render(<FilePanel open files={[]} currentPath="/srv" loading={false} dropTargetId="drop-zone" showHiddenFiles={false}
      defaultView="list" directoryMutationBusy {...handlers} />)

    expect(screen.getByRole('button', { name: '上传' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '新建文件夹' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '刷新' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '关闭' })).toBeEnabled()
  })

  it('blocks actions and direct activation for a path under mutation', async () => {
    const onDownload = vi.fn()
    const onNavigateTo = vi.fn()
    const file = { name: 'app.log', path: '/srv/app.log', size: 1, modified: '', isDir: false }
    render(<FilePanel open files={[file]} currentPath="/srv" loading={false} dropTargetId="drop-zone" showHiddenFiles={false}
      defaultView="list" isMutationBusy={(entry) => entry.path === file.path} {...handlers}
      onDownload={onDownload} onNavigateTo={onNavigateTo} />)
    const user = userEvent.setup()

    await user.click(screen.getByText('app.log'))
    expect(screen.getByRole('button', { name: '下载' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '重命名' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '删除' })).toBeDisabled()
    await user.dblClick(screen.getByText('app.log'))
    expect(onDownload).not.toHaveBeenCalled()
    expect(onNavigateTo).not.toHaveBeenCalled()
  })

  it('keeps cancellation available when another panel acquires the selected path lease', async () => {
    const file = { name: 'src', path: '/srv/src', size: 0, modified: '', isDir: true }
    const props = { open: true, files: [file], currentPath: '/srv', loading: false, dropTargetId: 'drop-zone', showHiddenFiles: false, defaultView: 'list' as const, ...handlers }
    const view = render(<FilePanel {...props} />)
    const user = userEvent.setup()
    await user.click(screen.getByText('src'))
    await user.click(screen.getByRole('button', { name: '删除' }))

    view.rerender(<FilePanel {...props} isMutationBusy={(entry) => entry.path === file.path} />)
    expect(screen.getByRole('button', { name: '删除' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '取消' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('passes directory identity to rename and delete mutations', async () => {
    const onRename = vi.fn(async () => undefined)
    const onDelete = vi.fn(async () => undefined)
    const file = { name: 'src', path: '/srv/src', size: 0, modified: '', isDir: true }
    render(<FilePanel open files={[file]} currentPath="/srv" loading={false} dropTargetId="drop-zone" showHiddenFiles={false}
      defaultView="list" {...handlers} onRename={onRename} onDelete={onDelete} />)
    const user = userEvent.setup()
    await user.click(screen.getByText('src'))
    await user.click(screen.getByRole('button', { name: '重命名' }))
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'renamed')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(onRename).toHaveBeenCalledWith('/srv/src', 'renamed', true)

    await user.click(screen.getByRole('button', { name: '删除' }))
    await user.click(screen.getByRole('button', { name: '删除' }))
    expect(onDelete).toHaveBeenCalledWith('/srv/src', true)
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
