import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import TunnelDialog from '@/components/session/TunnelDialog'
import { requestConfirm } from '@/lib/confirmDialog'
import type { Tunnel } from '@/hooks/useSession'

vi.mock('@/lib/confirmDialog', () => ({ requestConfirm: vi.fn(async () => true) }))

const tunnels: Tunnel[] = [
  tunnel('local-1', 'local', true),
  tunnel('remote-1', 'remote', false),
  tunnel('dynamic-1', 'dynamic', false),
  tunnel('custom-1', 'custom' as Tunnel['type'], false),
]

describe('TunnelDialog', () => {
  it('renders no content while closed and empty state while open', () => {
    const props = dialogProps()
    const { rerender } = render(<TunnelDialog {...props} open={false} />)
    expect(screen.queryByText('隧道管理')).not.toBeInTheDocument()

    rerender(<TunnelDialog {...props} open tunnels={[]} />)
    expect(screen.getByText('无隧道')).toBeInTheDocument()
  })

  it('creates local and dynamic tunnels with normalized values', async () => {
    const user = userEvent.setup()
    const props = dialogProps()
    render(<TunnelDialog {...props} />)

    await user.click(screen.getByRole('button', { name: '新建隧道' }))
    await user.type(screen.getByPlaceholderText('8080'), '2200')
    await user.type(screen.getByPlaceholderText('80'), '22')
    await user.click(screen.getByRole('button', { name: '启动' }))

    expect(props.onStart).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-7',
      type: 'local',
      localAddress: '127.0.0.1',
      localPort: 2200,
      remoteAddress: '127.0.0.1',
      remotePort: 22,
    }), expect.objectContaining({ silent: true }))
    expect(screen.queryByPlaceholderText('8080')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '新建隧道' }))
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: '动态转发' }))
    expect(screen.queryByPlaceholderText('80')).not.toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('127.0.0.1'), '0.0.0.0')
    await user.type(screen.getByPlaceholderText('1080'), '1080')
    await user.click(screen.getByRole('button', { name: '启动' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/回环/)
    expect(props.onStart).toHaveBeenCalledTimes(1)

    await user.clear(screen.getByLabelText('本地地址'))
    await user.type(screen.getByLabelText('本地地址'), '127.0.0.1')
    await user.click(screen.getByRole('button', { name: '启动' }))
    expect(props.onStart).toHaveBeenLastCalledWith(expect.objectContaining({
      sessionId: 'session-7',
      type: 'dynamic',
      localAddress: '127.0.0.1',
      localPort: 1080,
      remoteAddress: '127.0.0.1',
      remotePort: 0,
    }), expect.objectContaining({ silent: true }))
  })

  it('labels tunnel types and starts or stops existing tunnels', async () => {
    const user = userEvent.setup()
    const props = dialogProps()
    render(<TunnelDialog {...props} tunnels={tunnels} />)

    expect(screen.getByText('本地转发')).toBeInTheDocument()
    expect(screen.getByText('远程转发')).toBeInTheDocument()
    expect(screen.getByText('动态转发')).toBeInTheDocument()
    expect(screen.getByText('custom')).toBeInTheDocument()
    expect(screen.getByText('运行中')).toBeInTheDocument()
    expect(screen.getAllByText('已停止')).toHaveLength(3)

    const localRow = screen.getByText('本地转发').closest('tr')
    const remoteRow = screen.getByText('远程转发').closest('tr')
    expect(localRow).not.toBeNull()
    expect(remoteRow).not.toBeNull()
    await user.click(within(localRow!).getByRole('button', { name: '停止' }))
    await user.click(within(remoteRow!).getByRole('button', { name: '启动' }))

    expect(props.onStop).toHaveBeenCalledWith('local-1')
    expect(props.onStart).toHaveBeenCalledWith(expect.objectContaining({
      id: 'remote-1',
      sessionId: 'session-7',
      type: 'remote',
      localAddress: '127.0.0.1',
      localPort: 8080,
      remoteAddress: 'example.com',
      remotePort: 80,
    }))
    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('shows remote-forward exposure warning', async () => {
    const user = userEvent.setup()
    const props = dialogProps()
    render(<TunnelDialog {...props} />)
    await user.click(screen.getByRole('button', { name: '新建隧道' }))
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: '远程转发' }))
    expect(screen.getByText(/安全边界/)).toBeInTheDocument()
  })

  it('provides accessible names for tunnel controls', async () => {
    render(<TunnelDialog {...dialogProps()} />)
    await userEvent.click(screen.getByRole('button', { name: '新建隧道' }))

    expect(screen.getByRole('combobox', { name: '类型' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '本地地址' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: '本地端口' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '远程地址' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: '远程端口' })).toBeInTheDocument()
  })

  it('deletes existing tunnels after confirm', async () => {
    const user = userEvent.setup()
    const props = dialogProps()
    props.onDelete = vi.fn()
    render(<TunnelDialog {...props} tunnels={tunnels} />)
    const remoteRow = screen.getByText('远程转发').closest('tr')
    expect(remoteRow).not.toBeNull()
    await user.click(within(remoteRow!).getByRole('button', { name: '删除' }))
    expect(requestConfirm).toHaveBeenCalled()
    expect(props.onDelete).toHaveBeenCalledWith('remote-1')
  })

  it('does not delete when confirm is cancelled', async () => {
    vi.mocked(requestConfirm).mockResolvedValueOnce(false)
    const user = userEvent.setup()
    const props = dialogProps()
    props.onDelete = vi.fn()
    render(<TunnelDialog {...props} tunnels={tunnels} />)
    const remoteRow = screen.getByText('远程转发').closest('tr')
    await user.click(within(remoteRow!).getByRole('button', { name: '删除' }))
    expect(props.onDelete).not.toHaveBeenCalled()
  })

  it('keeps the form when start fails', async () => {
    const user = userEvent.setup()
    const props = dialogProps()
    props.onStart = vi.fn(async () => { throw new Error('start failed') })
    render(<TunnelDialog {...props} />)
    await user.click(screen.getByRole('button', { name: '新建隧道' }))
    await user.type(screen.getByPlaceholderText('8080'), '2200')
    await user.type(screen.getByPlaceholderText('80'), '22')
    await user.click(screen.getByRole('button', { name: '启动' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('start failed')
    expect(screen.getByPlaceholderText('8080')).toBeInTheDocument()
  })

  it('shows load failures instead of empty tunnels', async () => {
    const onReload = vi.fn(async () => {})
    render(<TunnelDialog {...dialogProps()} tunnels={[]} loadError="list boom" onReload={onReload} />)
    expect(screen.getByRole('alert')).toHaveTextContent('list boom')
    expect(screen.queryByText('无隧道')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(onReload).toHaveBeenCalled()
  })

  it('does not reset a reopened form when an older start completes', async () => {
    const pending = deferred<void>()
    const props = dialogProps()
    props.onStart = vi.fn(() => pending.promise)
    const view = render(<TunnelDialog {...props} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '新建隧道' }))
    await user.click(screen.getByRole('button', { name: '启动' }))
    view.rerender(<TunnelDialog {...props} open={false} />)
    view.rerender(<TunnelDialog {...props} open />)
    await act(async () => { pending.resolve(); await Promise.resolve() })
    expect(screen.getByPlaceholderText('8080')).toBeInTheDocument()
  })

  it('starts a new tunnel only once during a pending request', async () => {
    const pending = deferred<void>()
    const props = dialogProps()
    props.onStart = vi.fn(() => pending.promise)
    render(<TunnelDialog {...props} />)
    await userEvent.click(screen.getByRole('button', { name: '新建隧道' }))
    const submit = screen.getByRole('button', { name: '启动' })
    act(() => {
      fireEvent.click(submit)
      fireEvent.click(submit)
    })
    expect(props.onStart).toHaveBeenCalledOnce()
    await act(async () => { pending.resolve(); await Promise.resolve() })
  })
})


  it('surfaces list start failures dialog-owned without toast', async () => {
    const { useToastStore } = await import('@/components/ui/toast')
    useToastStore.setState({ toasts: [] })
    const user = userEvent.setup()
    const props = dialogProps()
    props.tunnels = [tunnel('local-1', 'local', false)]
    props.onStart = vi.fn(async () => { throw new Error('start boom') })
    render(<TunnelDialog {...props} />)
    await user.click(screen.getByRole('button', { name: '启动' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('启动隧道失败: start boom')
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })

  it('surfaces list stop failures dialog-owned without toast', async () => {
    const { useToastStore } = await import('@/components/ui/toast')
    useToastStore.setState({ toasts: [] })
    const user = userEvent.setup()
    const props = dialogProps()
    props.tunnels = [tunnel('local-1', 'local', true)]
    props.onStop = vi.fn(async () => { throw new Error('stop boom') })
    render(<TunnelDialog {...props} />)
    await user.click(screen.getByRole('button', { name: '停止' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('停止隧道失败: stop boom')
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })

  it('surfaces delete failures dialog-owned without toast', async () => {
    const { useToastStore } = await import('@/components/ui/toast')
    useToastStore.setState({ toasts: [] })
    const user = userEvent.setup()
    const props = dialogProps()
    props.tunnels = [tunnel('remote-1', 'remote', false)]
    props.onDelete = vi.fn(async () => { throw new Error('delete boom') })
    render(<TunnelDialog {...props} />)
    await user.click(screen.getByRole('button', { name: '删除' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('删除隧道失败: delete boom')
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })

function dialogProps() {
  return {
    open: true,
    onOpenChange: vi.fn(),
    tunnels: [] as Tunnel[],
    onStart: vi.fn(),
    onStop: vi.fn(),
    onDelete: vi.fn(),
    sessionId: 'session-7',
  }
}

function tunnel(id: string, type: Tunnel['type'], running: boolean): Tunnel {
  return {
    id,
    sessionId: 'session-7',
    type,
    localAddress: '127.0.0.1',
    localPort: 8080,
    remoteAddress: 'example.com',
    remotePort: 80,
    running,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
