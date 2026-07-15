import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tunnel } from '@/hooks/useSession'

const serviceCalls = vi.hoisted(() => ({
  create: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}))

vi.mock('@/components/file/TransferCenter', () => ({ TransferCenter: () => <div>transfer center</div> }))
vi.mock('@/components/session/TunnelDialog', () => ({
  default: ({ open, tunnels, onStart, onStop, sessionId }: {
    open: boolean
    tunnels: Tunnel[]
    onStart: (tunnel: Omit<Tunnel, 'id' | 'running'>) => void
    onStop: (tunnelId: string) => void
    sessionId: string
  }) => (
    <div data-testid="tunnel-dialog" data-open={open} data-session-id={sessionId}>
      <span>{tunnels.map((tunnel) => `${tunnel.id}:${tunnel.running}`).join(',')}</span>
      <button type="button" onClick={() => onStart({
        id: '5', sessionId, type: 'local', localAddress: '127.0.0.1', localPort: 8080,
        remoteAddress: '127.0.0.1', remotePort: 80,
      } as Omit<Tunnel, 'id' | 'running'>)}>start existing</button>
      <button type="button" onClick={() => onStart({
        sessionId, type: 'dynamic', localAddress: '127.0.0.1', localPort: 1080,
        remoteAddress: '', remotePort: 0,
      })}>create tunnel</button>
      <button type="button" onClick={() => onStop('5')}>stop tunnel</button>
    </div>
  ),
}))

import StatusBar from '@/components/layout/StatusBar'
import { useToastStore } from '@/components/ui/toast'
import { logger } from '@/lib/logger'
import { useAppStore } from '@/store/appStore'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'

const service = 'github.com/xuthus5/mssh/internal/service.'

describe('StatusBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __clearHandlers()
    useToastStore.setState({ toasts: [] })
    useAppStore.setState({
      tabs: [], activeSurface: null, connectionStatus: {}, appStatus: '就绪', tunnelState: {},
    })
    __registerHandler(service + 'TunnelService.Create', async (input) => {
      serviceCalls.create(input)
      return { ...input, id: 9 }
    })
    __registerHandler(service + 'TunnelService.Start', async (id) => { serviceCalls.start(id) })
    __registerHandler(service + 'TunnelService.Stop', async (id) => { serviceCalls.stop(id) })
  })

  it('shows terminal status and manages tunnels for the active session', async () => {
    __registerHandler(service + 'TunnelService.List', async () => [
      { id: 5, session_id: 1, type: 'local', local_host: null, local_port: 8080, remote_host: null, remote_port: 80 },
      { id: 6, session_id: 2, type: 'remote', local_host: 'localhost', local_port: 9000, remote_host: 'remote', remote_port: 90 },
    ])
    useAppStore.setState({
      tabs: [{ id: 'tab-1', title: 'production', type: 'terminal', terminalId: 'term-1', sessionId: 1 }],
      activeSurface: { type: 'terminal', id: 'tab-1' },
      connectionStatus: { 'term-1': 'connected' },
      tunnelState: { '5': 'running' },
    })

    render(<StatusBar />)

    expect(screen.getByText('已连接')).toBeInTheDocument()
    expect(screen.getByText('production')).toBeInTheDocument()
    await userEvent.click(screen.getByTitle('隧道管理'))
    await waitFor(() => expect(screen.getByTestId('tunnel-dialog')).toHaveAttribute('data-open', 'true'))
    expect(screen.getByTestId('tunnel-dialog')).toHaveAttribute('data-session-id', '1')
    expect(screen.getByTestId('tunnel-dialog')).toHaveTextContent('5:true')
    expect(screen.getByTestId('tunnel-dialog')).not.toHaveTextContent('6:false')

    await userEvent.click(screen.getByRole('button', { name: 'start existing' }))
    await waitFor(() => expect(serviceCalls.start).toHaveBeenCalledWith(5))
    await userEvent.click(screen.getByRole('button', { name: 'create tunnel' }))
    await waitFor(() => expect(serviceCalls.start).toHaveBeenCalledWith(9))
    expect(serviceCalls.create).toHaveBeenCalledWith(expect.objectContaining({ session_id: 1, local_port: 1080 }))
    await userEvent.click(screen.getByRole('button', { name: 'stop tunnel' }))
    await waitFor(() => expect(serviceCalls.stop).toHaveBeenCalledWith(5))
  })

  it('keeps playback on app status and reports tunnel loading failures', async () => {
    __registerHandler(service + 'TunnelService.List', async () => { throw new Error('list failed') })
    useAppStore.setState({
      tabs: [{ id: 'playback-1', title: 'replay', type: 'playback', recordingPath: '/tmp/replay.log' }],
      activeSurface: { type: 'playback', id: 'playback-1' },
      appStatus: '应用就绪',
    })
    const view = render(<StatusBar />)

    expect(screen.getByText('应用就绪')).toBeInTheDocument()
    expect(screen.getByText('replay')).toBeInTheDocument()
    expect(screen.getByTitle('隧道管理')).toBeDisabled()
    expect(screen.getByTestId('tunnel-dialog')).toHaveAttribute('data-session-id', '')

    useAppStore.setState({
      tabs: [{ id: 'tab-1', title: 'terminal', type: 'terminal', terminalId: 'term-1', sessionId: 1 }],
      activeSurface: { type: 'terminal', id: 'tab-1' },
    })
    view.rerender(<StatusBar />)
    await userEvent.click(screen.getByTitle('隧道管理'))
    await waitFor(() => expect(useToastStore.getState().toasts).toContainEqual(
      expect.objectContaining({ message: '加载隧道失败: list failed', type: 'error' }),
    ))
  })

  it('reports tunnel create, start, and stop failures', async () => {
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => {})
    __registerHandler(service + 'TunnelService.List', async () => [])
    __registerHandler(service + 'TunnelService.Create', async () => null)
    __registerHandler(service + 'TunnelService.Start', async () => { throw new Error('start failed') })
    __registerHandler(service + 'TunnelService.Stop', async () => { throw new Error('stop failed') })
    useAppStore.setState({
      tabs: [{ id: 'tab-1', title: 'terminal', type: 'terminal', terminalId: 'term-1', sessionId: 1 }],
      activeSurface: { type: 'terminal', id: 'tab-1' },
    })
    render(<StatusBar />)
    await userEvent.click(screen.getByTitle('隧道管理'))

    await userEvent.click(screen.getByRole('button', { name: 'start existing' }))
    await waitFor(() => expect(useToastStore.getState().toasts).toContainEqual(
      expect.objectContaining({ message: '启动隧道失败: start failed', type: 'error' }),
    ))
    await userEvent.click(screen.getByRole('button', { name: 'create tunnel' }))
    await waitFor(() => expect(useToastStore.getState().toasts).toContainEqual(
      expect.objectContaining({ message: '启动隧道失败: 创建隧道失败', type: 'error' }),
    ))
    await userEvent.click(screen.getByRole('button', { name: 'stop tunnel' }))
    await waitFor(() => expect(useToastStore.getState().toasts).toContainEqual(
      expect.objectContaining({ message: '停止隧道失败: stop failed', type: 'error' }),
    ))
    expect(loggerError).toHaveBeenCalledTimes(2)
  })
})
