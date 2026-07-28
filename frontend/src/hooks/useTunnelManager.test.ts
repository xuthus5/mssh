import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTunnelManager } from '@/hooks/useTunnelManager'
import { useToastStore } from '@/components/ui/toast'
import { OperationBusyError } from '@/lib/operationBusyError'
import { resetTunnelMutationCoordinator } from '@/lib/tunnelMutationCoordinator'

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
    resetTunnelMutationCoordinator()
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

  it('silent start failures do not toast (form path owns inline error)', async () => {
    start.mockRejectedValueOnce(new Error('bind failed'))
    const { result } = renderHook(() => useTunnelManager(7))
    let caught: unknown
    await act(async () => {
      try {
        await result.current.start({
          sessionId: '7',
          type: 'local',
          localAddress: '127.0.0.1',
          localPort: 1,
          remoteAddress: '127.0.0.1',
          remotePort: 22,
        }, { silent: true })
      } catch (error) {
        caught = error
      }
    })
    expect(caught).toBeTruthy()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('non-silent start failures rethrow without toast for dialog ownership', async () => {
    start.mockRejectedValueOnce(new Error('bind failed'))
    const { result } = renderHook(() => useTunnelManager(7))
    let caught: unknown
    await act(async () => {
      try {
        await result.current.start({
          id: '42',
          sessionId: '7',
          type: 'local',
          localAddress: '127.0.0.1',
          localPort: 1,
          remoteAddress: '127.0.0.1',
          remotePort: 22,
        })
      } catch (error) {
        caught = error
      }
    })
    expect(caught).toBeTruthy()
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })

  it('stop failures rethrow without toast', async () => {
    stop.mockRejectedValueOnce(new Error('stop boom'))
    const { result } = renderHook(() => useTunnelManager(7))
    await act(async () => {
      await expect(result.current.stop('42')).rejects.toThrow('stop boom')
    })
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })

  it('delete failures rethrow without toast', async () => {
    del.mockRejectedValueOnce(new Error('delete boom'))
    const { result } = renderHook(() => useTunnelManager(7))
    await act(async () => {
      await expect(result.current.remove('42')).rejects.toThrow('delete boom')
    })
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })

  it('sets load error without toast so empty list is not assumed', async () => {
    list.mockRejectedValueOnce(new Error('list boom'))
    const { result } = renderHook(() => useTunnelManager(7))
    await act(async () => {
      await result.current.load()
    })
    expect(result.current.error).toBe('list boom')
    expect(result.current.tunnels).toEqual([])
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('silent load failures do not set panel error', async () => {
    list.mockRejectedValueOnce(new Error('silent boom'))
    const { result } = renderHook(() => useTunnelManager(7))
    await act(async () => {
      await result.current.load({ silent: true })
    })
    expect(result.current.error).toBe('')
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('keeps the newest tunnel list when loads resolve out of order', async () => {
    const first = deferred<unknown[]>()
    const second = deferred<unknown[]>()
    list.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
    const hook = renderHook(({ sessionID }) => useTunnelManager(sessionID), { initialProps: { sessionID: 7 } })
    let firstLoad!: Promise<void>
    await act(async () => { firstLoad = hook.result.current.load() })
    hook.rerender({ sessionID: 8 })
    let secondLoad!: Promise<void>
    await act(async () => { secondLoad = hook.result.current.load() })
    await act(async () => { second.resolve([tunnel(8, 2)]); await secondLoad })
    expect(hook.result.current.tunnels[0].sessionId).toBe('8')
    await act(async () => { first.resolve([tunnel(7, 1)]); await firstLoad })
    expect(hook.result.current.tunnels[0].sessionId).toBe('8')
  })

  it('hides the previous session catalog immediately after switching sessions', async () => {
    list.mockResolvedValueOnce([tunnel(7, 42)])
    const hook = renderHook(({ sessionID }) => useTunnelManager(sessionID), { initialProps: { sessionID: 7 } })
    await act(async () => { await hook.result.current.load() })
    expect(hook.result.current.tunnels.map((item) => item.id)).toEqual(['42'])

    hook.rerender({ sessionID: 8 })

    expect(hook.result.current.tunnels).toEqual([])
    expect(hook.result.current.error).toBe('')
    expect(hook.result.current.loading).toBe(false)
  })

  it('serializes mutations across managers for the same session', async () => {
    const pending = deferred<void>()
    stop.mockImplementationOnce(() => pending.promise).mockResolvedValue(undefined)
    const first = renderHook(() => useTunnelManager(7))
    const second = renderHook(() => useTunnelManager(7))
    const other = renderHook(() => useTunnelManager(8))
    let firstStop!: Promise<void>

    await act(async () => {
      firstStop = first.result.current.stop('42')
      await Promise.resolve()
    })
    await act(async () => {
      await expect(second.result.current.remove('42')).rejects.toBeInstanceOf(OperationBusyError)
      await other.result.current.stop('77')
    })

    expect(del).not.toHaveBeenCalled()
    expect(stop).toHaveBeenCalledWith(42)
    expect(stop).toHaveBeenCalledWith(77)
    await act(async () => { pending.resolve(); await firstStop })
  })

  it('refreshes other managers after a successful mutation', async () => {
    stop.mockResolvedValue(undefined)
    renderHook(() => useTunnelManager(7))
    const source = renderHook(() => useTunnelManager(7))
    renderHook(() => useTunnelManager(8))

    await act(async () => { await source.result.current.stop('42') })

    await waitFor(() => expect(list).toHaveBeenCalledOnce())
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function tunnel(sessionID: number, id: number) {
  return { id, session_id: sessionID, type: 'local', local_host: '127.0.0.1', local_port: 2200, remote_host: '127.0.0.1', remote_port: 22 }
}
