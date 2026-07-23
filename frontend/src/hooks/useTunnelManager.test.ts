import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTunnelManager } from '@/hooks/useTunnelManager'
import { useToastStore } from '@/components/ui/toast'

const create = vi.fn()
const start = vi.fn()
const stop = vi.fn()
const del = vi.fn()
const list = vi.fn()

vi.mock('@/lib/wails', () => ({
  TunnelService: {
    Create: (...args: unknown[]) => create(...args),
    Start: (...args: unknown[]) => start(...args),
    Stop: (...args: unknown[]) => stop(...args),
    Delete: (...args: unknown[]) => del(...args),
    List: (...args: unknown[]) => list(...args),
  },
}))

describe('useTunnelManager', () => {
  beforeEach(() => {
    create.mockReset()
    start.mockReset()
    stop.mockReset()
    del.mockReset()
    list.mockReset()
    useToastStore.setState({ toasts: [] })
    list.mockResolvedValue([])
  })

  it('starts existing tunnels by id without recreating', async () => {
    const { result } = renderHook(() => useTunnelManager(7))
    await act(async () => {
      await result.current.start({
        id: '42',
        sessionId: '7',
        type: 'local',
        localAddress: '127.0.0.1',
        localPort: 8080,
        remoteAddress: 'example.com',
        remotePort: 80,
      })
    })
    expect(create).not.toHaveBeenCalled()
    expect(start).toHaveBeenCalledWith(42)
  })

  it('creates then starts new tunnels', async () => {
    create.mockResolvedValue({
      id: 9,
      session_id: 7,
      type: 'local',
      local_host: '127.0.0.1',
      local_port: 2200,
      remote_host: '127.0.0.1',
      remote_port: 22,
    })
    start.mockResolvedValue(undefined)
    const { result } = renderHook(() => useTunnelManager(7))
    await act(async () => {
      await result.current.start({
        sessionId: '7',
        type: 'local',
        localAddress: '127.0.0.1',
        localPort: 2200,
        remoteAddress: '127.0.0.1',
        remotePort: 22,
      })
    })
    expect(create).toHaveBeenCalled()
    expect(start).toHaveBeenCalledWith(9)
  })

  it('deletes tunnels even when stop is not running', async () => {
    stop.mockRejectedValueOnce(new Error('tunnel 42 not running'))
    del.mockResolvedValue(undefined)
    const { result } = renderHook(() => useTunnelManager(7))
    await act(async () => {
      await result.current.remove('42')
    })
    expect(del).toHaveBeenCalledWith(42)
    expect(useToastStore.getState().toasts.some((item) => item.message.includes('隧道已删除') || item.type === 'success')).toBe(true)
  })
})
