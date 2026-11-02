import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ListeningPanel } from '@/components/terminal/listener/ListeningPanel'

const terminalService = vi.hoisted(() => ({ ListeningPorts: vi.fn() }))

vi.mock('@/lib/wails', () => ({ TerminalService: terminalService }))

const ports = [
  { protocol: 'tcp', address: '0.0.0.0', port: 22, pid: 123, process_name: 'sshd' },
  { protocol: 'tcp', address: '::', port: 443, pid: 456, process_name: 'nginx' },
  { protocol: 'udp', address: '127.0.0.53', port: 53, pid: 654, process_name: 'systemd-resolve' },
]

describe('ListeningPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    terminalService.ListeningPorts.mockResolvedValue(ports)
  })

  it('loads and filters listening ports', async () => {
    const user = userEvent.setup()
    render(<ListeningPanel terminalID="term-1" active />)
    expect(await screen.findByText('sshd')).toBeInTheDocument()
    expect(terminalService.ListeningPorts).toHaveBeenCalledWith('term-1')
    expect(screen.getByText('0.0.0.0')).toBeInTheDocument()
    expect(screen.getByText('443')).toBeInTheDocument()

    await user.type(screen.getByLabelText('搜索端口、地址、PID 或进程'), 'systemd')
    expect(screen.getByText('systemd-resolve')).toBeInTheDocument()
    expect(screen.queryByText('sshd')).not.toBeInTheDocument()
  })

  it('renders protocol, address, port, pid and process columns', async () => {
    render(<ListeningPanel terminalID="term-1" active />)
    const table = await screen.findByTestId('listening-table')
    expect(table).toHaveTextContent('协议')
    expect(table).toHaveTextContent('监听地址')
    expect(table).toHaveTextContent('进程名称')
    expect(table).toHaveTextContent('123')
  })

  it('shows an empty state when there are no listeners', async () => {
    terminalService.ListeningPorts.mockResolvedValue([])
    render(<ListeningPanel terminalID="term-empty" active />)
    expect(await screen.findByText('未发现监听端口')).toBeInTheDocument()
  })

  it('shows collection failures and retries', async () => {
    const user = userEvent.setup()
    terminalService.ListeningPorts.mockRejectedValueOnce(new Error('probe failed')).mockResolvedValueOnce(ports)
    render(<ListeningPanel terminalID="term-retry" active />)
    expect(await screen.findByRole('alert')).toHaveTextContent('监听端口采集失败')
    await user.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(screen.getByText('sshd')).toBeInTheDocument())
  })

  it('does not collect while inactive', async () => {
    render(<ListeningPanel terminalID="term-inactive" active={false} />)
    expect(await screen.findByText('正在采集监听端口...')).toBeInTheDocument()
    expect(terminalService.ListeningPorts).not.toHaveBeenCalled()
  })
})
