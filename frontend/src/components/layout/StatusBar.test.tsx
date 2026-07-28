import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/file/TransferCenter', () => ({ TransferCenter: () => <div>transfer center</div> }))
const terminalService = vi.hoisted(() => ({ SystemInfo: vi.fn() }))
vi.mock('@/lib/wails', () => ({ TerminalService: terminalService }))

import StatusBar from '@/components/layout/StatusBar'
import { useAppStore } from '@/store/appStore'

describe('StatusBar', () => {
  beforeEach(() => {
    terminalService.SystemInfo.mockReset()
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

function systemInfo(cpu_percent: number): Record<string, number> {
  return { cpu_percent, cpu_count: 8, memory_used: 1, memory_total: 2, disk_used: 1, disk_total: 2, download_rate: 1, upload_rate: 1 }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
