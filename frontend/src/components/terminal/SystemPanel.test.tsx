import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SystemPanel } from '@/components/terminal/SystemPanel'

const systemInfo = { cpu_percent: 42, cpu_count: 8, memory_used: 2 * 1024 ** 3, memory_total: 8 * 1024 ** 3, disk_used: 10 * 1024 ** 3, disk_total: 100 * 1024 ** 3, download_rate: 1024, upload_rate: 2048, swap_used: 0, swap_total: 0, load_1: 1.2, load_5: 0.8, load_15: 0.4, uptime_seconds: 3661, os_name: 'A B C', kernel_version: '6.8' }
const processInfo = [{ pid: 10, ppid: 1, user: 'root', state: 'S', cpu_percent: 9.5, memory_bytes: 1024 ** 2, command: 'tmux' }, { pid: 11, ppid: 1, user: 'dev', state: 'R', cpu_percent: 1.5, memory_bytes: 2 * 1024 ** 2, command: 'vim' }]
const terminalService = vi.hoisted(() => ({ SystemInfo: vi.fn(), ProcessInfo: vi.fn() }))

vi.mock('@/lib/wails', () => ({ TerminalService: terminalService }))

describe('SystemPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    terminalService.SystemInfo.mockResolvedValue(systemInfo)
    terminalService.ProcessInfo.mockResolvedValue(processInfo)
  })

  it('renders overview metrics and refreshes from the terminal service', async () => {
    render(<SystemPanel terminalID="term-1" onClose={vi.fn()} />)
    expect(await screen.findByText('42% (8c)')).toBeInTheDocument()
    expect(screen.getByText('A B C')).toBeInTheDocument()
    expect(terminalService.SystemInfo).toHaveBeenCalledWith('term-1')
  })

  it.each([
    [512, 1024, '↓512B/s ↑1K/s'],
    [1536, 2 * 1024 ** 2, '↓1.5K/s ↑2M/s'],
  ])('adapts network units for %d and %d bytes per second', async (downloadRate, uploadRate, expected) => {
    terminalService.SystemInfo.mockResolvedValue({ ...systemInfo, download_rate: downloadRate, upload_rate: uploadRate })
    render(<SystemPanel terminalID="term-network" onClose={vi.fn()} />)
    expect(await screen.findByText(expected)).toBeInTheDocument()
  })

  it('loads processes only after opening the process tab and supports search', async () => {
    const user = userEvent.setup()
    render(<SystemPanel terminalID="term-2" onClose={vi.fn()} />)
    expect(terminalService.ProcessInfo).not.toHaveBeenCalled()
    await user.click(screen.getByRole('tab', { name: '进程' }))
    expect((await screen.findAllByText('tmux')).length).toBeGreaterThan(0)
    await user.type(screen.getByPlaceholderText('搜索 PID、用户或命令'), 'vim')
    expect(screen.getAllByText('vim').length).toBeGreaterThan(0)
  })

  it('shows collection errors without throwing', async () => {
    terminalService.SystemInfo.mockRejectedValueOnce(new Error('probe failed'))
    render(<SystemPanel terminalID="term-3" onClose={vi.fn()} />)
    expect(await screen.findByText('系统信息采集失败')).toBeInTheDocument()
    await waitFor(() => expect(terminalService.SystemInfo).toHaveBeenCalled())
  })

  it('closes through the supplied callback', async () => {
    const onClose = vi.fn()
    render(<SystemPanel terminalID="term-4" onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: '关闭系统监控' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
