import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import QuickCommands from '@/components/session/QuickCommands'
import { requestConfirm } from '@/lib/confirmDialog'

vi.mock('@/lib/confirmDialog', () => ({ requestConfirm: vi.fn(async () => true) }))

const commands = [
  { id: 'list', name: 'List files', shortcut: 'Ctrl+L', command: 'ls -la' },
  { id: 'pwd', name: 'Working directory', shortcut: '', command: 'pwd' },
]

describe('QuickCommands', () => {
  it('renders empty state and hides creation controls when disabled', () => {
    render(
      <QuickCommands
        commands={[]}
        onExecute={vi.fn()}
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        showAddForm={false}
      />,
    )

    expect(screen.getByText('暂无快捷命令')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('validates, trims, submits, and resets the add form', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    render(<QuickCommands commands={[]} onExecute={vi.fn()} onAdd={onAdd} onDelete={vi.fn()} />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByRole('button', { name: '添加' }))
    expect(onAdd).not.toHaveBeenCalled()

    await user.type(screen.getByPlaceholderText('名称'), '  Deploy  ')
    await user.type(screen.getByPlaceholderText('快捷键 (可选)'), '  Ctrl+D  ')
    await user.type(screen.getByPlaceholderText('命令'), '  make deploy  ')
    await user.click(screen.getByRole('button', { name: '添加' }))

    expect(onAdd).toHaveBeenCalledWith({ name: 'Deploy', shortcut: 'Ctrl+D', command: 'make deploy' })
    expect(screen.queryByPlaceholderText('名称')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button'))
    expect(screen.getByPlaceholderText('名称')).toHaveValue('')
    expect(screen.getByPlaceholderText('快捷键 (可选)')).toHaveValue('')
    expect(screen.getByPlaceholderText('命令')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByPlaceholderText('名称')).not.toBeInTheDocument()
  })

  it('executes, deletes after confirm, and exposes commands through drag data', async () => {
    const user = userEvent.setup()
    const onExecute = vi.fn()
    const onDelete = vi.fn()
    const setData = vi.fn()
    render(<QuickCommands commands={commands} onExecute={onExecute} onAdd={vi.fn()} onDelete={onDelete} />)

    const row = screen.getByText('List files').closest<HTMLElement>('[draggable="true"]')
    expect(row).not.toBeNull()
    fireEvent.dragStart(row!, { dataTransfer: { setData } })
    expect(setData).toHaveBeenCalledWith('text/plain', 'ls -la')

    await user.click(row!)
    expect(onExecute).toHaveBeenCalledWith('ls -la')

    await user.click(within(row!).getByRole('button', { name: '删除 List files' }))
    await waitFor(() => expect(requestConfirm).toHaveBeenCalled())
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('list'))
    expect(onExecute).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Ctrl+L')).toBeInTheDocument()
  })

  it('does not delete when confirmation is cancelled', async () => {
    vi.mocked(requestConfirm).mockResolvedValueOnce(false)
    const user = userEvent.setup()
    const onDelete = vi.fn()
    render(<QuickCommands commands={commands} onExecute={vi.fn()} onAdd={vi.fn()} onDelete={onDelete} />)
    const row = screen.getByText('List files').closest<HTMLElement>('[draggable="true"]')
    await user.click(within(row!).getByRole('button', { name: '删除 List files' }))
    await waitFor(() => expect(requestConfirm).toHaveBeenCalled())
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('keeps delete actions keyboard-discoverable via focus-within styles', () => {
    render(<QuickCommands commands={commands} onExecute={vi.fn()} onAdd={vi.fn()} onDelete={vi.fn()} />)
    const row = screen.getByText('List files').closest<HTMLElement>('[draggable="true"]')
    const button = within(row!).getByRole('button', { name: '删除 List files' })
    expect(button.className).toContain('group-focus-within:opacity-100')
    expect(button.className).toContain('sm:opacity-0')
  })

  it('locks add and delete mutations when an external lease is active', async () => {
    vi.mocked(requestConfirm).mockClear()
    const onAdd = vi.fn()
    const onDelete = vi.fn()
    render(<QuickCommands commands={commands} onExecute={vi.fn()} onAdd={onAdd} onDelete={onDelete} mutationDisabled />)

    const add = screen.getByRole('button', { name: '添加快捷命令' })
    const remove = screen.getByRole('button', { name: '删除 List files' })
    expect(add).toBeDisabled()
    expect(remove).toBeDisabled()
    fireEvent.click(add)
    fireEvent.click(remove)
    expect(onAdd).not.toHaveBeenCalled()
    expect(onDelete).not.toHaveBeenCalled()
    expect(requestConfirm).not.toHaveBeenCalled()
  })

  it('executes a command from the keyboard and labels the add action', () => {
    const onExecute = vi.fn()
    render(<QuickCommands commands={commands} onExecute={onExecute} onAdd={vi.fn()} onDelete={vi.fn()} />)
    const row = screen.getByRole('button', { name: '执行宏 List files' })
    expect(screen.getByRole('button', { name: '添加快捷命令' })).toBeInTheDocument()

    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })
    expect(onExecute).toHaveBeenCalledTimes(2)
    expect(onExecute).toHaveBeenNthCalledWith(1, 'ls -la')
    expect(onExecute).toHaveBeenNthCalledWith(2, 'ls -la')
  })
})

  it('keeps add form open when onAdd rejects', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn(async () => { throw new Error('create boom') })
    render(<QuickCommands commands={[]} onExecute={vi.fn()} onAdd={onAdd} onDelete={vi.fn()} />)
    await user.click(screen.getByRole('button'))
    await user.type(screen.getByPlaceholderText('名称'), 'Deploy')
    await user.type(screen.getByPlaceholderText('命令'), 'deploy')
    await user.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => expect(onAdd).toHaveBeenCalled())
    expect(screen.getByPlaceholderText('名称')).toHaveValue('Deploy')
    expect(screen.getByPlaceholderText('命令')).toHaveValue('deploy')
    expect(screen.getByPlaceholderText('名称')).toBeEnabled()
    expect(screen.getByRole('button', { name: '添加' })).toBeEnabled()
  })

  it('keeps the add form locked until the pending request settles', async () => {
    const pending = deferred<void>()
    const onAdd = vi.fn(() => pending.promise)
    const user = userEvent.setup()
    render(<QuickCommands commands={[]} onExecute={vi.fn()} onAdd={onAdd} onDelete={vi.fn()} />)
    const toggle = screen.getByRole('button', { name: '添加快捷命令' })
    await user.click(toggle)
    await user.type(screen.getByPlaceholderText('名称'), 'Deploy')
    await user.type(screen.getByPlaceholderText('命令'), 'deploy')
    await user.click(screen.getByRole('button', { name: '添加' }))

    expect(toggle).toBeDisabled()
    expect(screen.getByPlaceholderText('名称')).toBeDisabled()
    expect(screen.getByPlaceholderText('快捷键 (可选)')).toBeDisabled()
    expect(screen.getByPlaceholderText('命令')).toBeDisabled()
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '添加中...' })).toBeDisabled()
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '添加中...' }))
    expect(onAdd).toHaveBeenCalledOnce()
    expect(screen.getByPlaceholderText('名称')).toHaveValue('Deploy')

    await act(async () => { pending.resolve(); await Promise.resolve() })
    expect(screen.queryByPlaceholderText('名称')).not.toBeInTheDocument()
    expect(toggle).toBeEnabled()
  })

  it('adds a command only once during a pending request', async () => {
    const pending = deferred<void>()
    const onAdd = vi.fn(() => pending.promise)
    render(<QuickCommands commands={[]} onExecute={vi.fn()} onAdd={onAdd} onDelete={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '添加快捷命令' }))
    await userEvent.type(screen.getByPlaceholderText('名称'), 'Deploy')
    await userEvent.type(screen.getByPlaceholderText('命令'), 'deploy')
    const add = screen.getByRole('button', { name: '添加' })
    act(() => {
      fireEvent.click(add)
      fireEvent.click(add)
    })
    expect(onAdd).toHaveBeenCalledOnce()
    await act(async () => { pending.resolve(); await Promise.resolve() })
  })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
