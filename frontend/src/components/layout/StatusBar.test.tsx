import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/file/TransferCenter', () => ({ TransferCenter: () => <div>transfer center</div> }))
const terminalService = vi.hoisted(() => ({ SystemInfo: vi.fn() }))
vi.mock('@/lib/wails', () => ({ TerminalService: terminalService }))
const platformMock = vi.hoisted(() => ({ isWindowsPlatform: vi.fn() }))
vi.mock('@/lib/platform', () => ({ isWindowsPlatform: platformMock.isWindowsPlatform }))

import StatusBar from '@/components/layout/StatusBar'
import { useAppStore } from '@/store/appStore'

describe('StatusBar', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllTimers()
    terminalService.SystemInfo.mockReset()
    platformMock.isWindowsPlatform.mockReset()
    useAppStore.setState({ tabs: [], activeSurface: null, connectionStatus: {}, appStatus: '就绪' })
  })

  afterEach(() => vi.useRealTimers())

  it('shows the active terminal status without the tunnel action', () => {
    useAppStore.setState({
      tabs: [{ id: 'tab-1', title: 'production', type: 'terminal', terminalId: 'term-1', sessionId: 1 }],
      activeSurface: { type: 'terminal', id: 'tab-1' },
      connectionStatus: { 'term-1': 'connected' },
    })

    render(<StatusBar />)

    expect(screen.getByText('已连接')).toBeInTheDocument()
    expect(screen.getByText('production')).toBeInTheDocument()
    expect(screen.queryByTitle('隧道管理')).not.toBeInTheDocument()
  })

  it('shows application status for a non-terminal surface', () => {
    useAppStore.setState({
      tabs: [{ id: 'playback-1', title: 'replay', type: 'playback', recordingPath: '/tmp/replay.log' }],
      activeSurface: { type: 'playback', id: 'playback-1' },
      appStatus: '应用就绪',
    })

    render(<StatusBar />)

    expect(screen.getByText('应用就绪')).toBeInTheDocument()
    expect(screen.getByText('replay')).toBeInTheDocument()
  })

  it('does not overlap slow system info polls', async () => {
    vi.useFakeTimers()
    const first = deferred<Record<string, number>>()
    terminalService.SystemInfo.mockImplementationOnce(() => first.promise).mockResolvedValue(systemInfo(20))
    useAppStore.setState({
      tabs: [{ id: 'tab-1', title: 'production', type: 'terminal', terminalId: 'term-1', sessionId: 1 }],
      activeSurface: { type: 'terminal', id: 'tab-1' },
      connectionStatus: { 'term-1': 'connected' },
    })
    render(<StatusBar />)
    await act(async () => { await Promise.resolve() })
    await act(async () => { await vi.advanceTimersByTimeAsync(9000) })
    expect(terminalService.SystemInfo).toHaveBeenCalledOnce()
    await act(async () => { first.resolve(systemInfo(80)); await Promise.resolve() })
    expect(screen.getByLabelText('系统信息')).toHaveTextContent('80%')
    await act(async () => { await vi.advanceTimersByTimeAsync(2999) })
    expect(terminalService.SystemInfo).toHaveBeenCalledOnce()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(terminalService.SystemInfo).toHaveBeenCalledTimes(2)
  })
})

  it('skips system info collection for local terminal on windows', async () => {
    platformMock.isWindowsPlatform.mockReturnValue(true)
    useAppStore.setState({
      tabs: [{ id: 'tab-local', title: '本地终端', type: 'terminal', terminalId: 'term-local', sessionId: 0, connectionKind: 'local' }],
      activeSurface: { type: 'terminal', id: 'tab-local' },
      connectionStatus: { 'term-local': 'connected' },
    })
    render(<StatusBar />)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
    expect(terminalService.SystemInfo).not.toHaveBeenCalledWith('term-local')
  })

  it('still collects system info for local terminal on non-windows', async () => {
    platformMock.isWindowsPlatform.mockReturnValue(false)
    terminalService.SystemInfo.mockResolvedValue(systemInfo(10))
    useAppStore.setState({
      tabs: [{ id: 'tab-local', title: '本地终端', type: 'terminal', terminalId: 'term-local', sessionId: 0, connectionKind: 'local' }],
      activeSurface: { type: 'terminal', id: 'tab-local' },
      connectionStatus: { 'term-local': 'connected' },
    })
    render(<StatusBar />)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
    expect(terminalService.SystemInfo).toHaveBeenCalledWith('term-local')
  })

  it('still collects system info for windows ssh terminal', async () => {
    platformMock.isWindowsPlatform.mockReturnValue(true)
    terminalService.SystemInfo.mockResolvedValue(systemInfo(30))
    useAppStore.setState({
      tabs: [{ id: 'tab-ssh', title: 'remote', type: 'terminal', terminalId: 'term-ssh', sessionId: 5, connectionKind: 'ssh' }],
      activeSurface: { type: 'terminal', id: 'tab-ssh' },
      connectionStatus: { 'term-ssh': 'connected' },
    })
    render(<StatusBar />)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
    expect(terminalService.SystemInfo).toHaveBeenCalledWith('term-ssh')
  })

function systemInfo(cpu_percent: number): Record<string, number> {
  return { cpu_percent, cpu_count: 8, memory_used: 1, memory_total: 2, disk_used: 1, disk_total: 2, download_rate: 1, upload_rate: 1 }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
