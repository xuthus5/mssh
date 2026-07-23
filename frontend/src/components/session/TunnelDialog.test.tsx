import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import TunnelDialog from '@/components/session/TunnelDialog'
import type { Tunnel } from '@/hooks/useSession'

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

    expect(props.onStart).toHaveBeenCalledWith({
      sessionId: 'session-7',
      type: 'local',
      localAddress: '127.0.0.1',
      localPort: 2200,
      remoteAddress: '127.0.0.1',
      remotePort: 22,
    })
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
    expect(props.onStart).toHaveBeenLastCalledWith({
      sessionId: 'session-7',
      type: 'dynamic',
      localAddress: '127.0.0.1',
      localPort: 1080,
      remoteAddress: '127.0.0.1',
      remotePort: 0,
    })
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
    expect(props.onStart).toHaveBeenCalledWith({
      sessionId: 'session-7',
      type: 'remote',
      localAddress: '127.0.0.1',
      localPort: 8080,
      remoteAddress: 'example.com',
      remotePort: 80,
    })
    expect(screen.getByText('-')).toBeInTheDocument()
  })
})

function dialogProps() {
  return {
    open: true,
    onOpenChange: vi.fn(),
    tunnels: [] as Tunnel[],
    onStart: vi.fn(),
    onStop: vi.fn(),
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
