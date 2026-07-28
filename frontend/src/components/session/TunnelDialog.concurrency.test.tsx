import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TunnelDialog from '@/components/session/TunnelDialog'
import type { Tunnel } from '@/hooks/useSession'
import { requestConfirm } from '@/lib/confirmDialog'
import { resetTunnelMutationCoordinator, runTunnelMutation } from '@/lib/tunnelMutationCoordinator'

vi.mock('@/lib/confirmDialog', () => ({ requestConfirm: vi.fn() }))

describe('TunnelDialog concurrency', () => {
  beforeEach(() => {
    vi.mocked(requestConfirm).mockReset()
    vi.mocked(requestConfirm).mockResolvedValue(true)
    resetTunnelMutationCoordinator()
  })

  it('keeps the submit lease across session changes and blocks closing', async () => {
    const pending = deferred<void>()
    const onStart = vi.fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(undefined)
    const props = dialogProps({ onStart })
    const view = render(<TunnelDialog {...props} />)
    await userEvent.click(screen.getByRole('button', { name: '新建隧道' }))
    await userEvent.click(screen.getByRole('button', { name: '启动' }))

    view.rerender(<TunnelDialog {...props} sessionId="session-2" />)

    expect(screen.getByRole('button', { name: '启动中…' })).toBeDisabled()
    expect(screen.getByPlaceholderText('8080')).toBeDisabled()
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(props.onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await act(async () => pending.resolve())

    await userEvent.click(screen.getByRole('button', { name: '启动' }))
    expect(onStart).toHaveBeenCalledTimes(2)
    expect(onStart).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: 'session-2' }), expect.anything())
  })

  it('keeps a list action lease across session changes', async () => {
    const pending = deferred<void>()
    const onStop = vi.fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(undefined)
    const props = dialogProps({ onStop, tunnels: [tunnel('old', 'session-1')] })
    const view = render(<TunnelDialog {...props} />)
    await userEvent.click(screen.getByRole('button', { name: '停止' }))

    view.rerender(<TunnelDialog {...props} sessionId="session-2" tunnels={[tunnel('new', 'session-2')]} />)

    expect(screen.getByRole('button', { name: '停止' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(props.onOpenChange).not.toHaveBeenCalled()
    await act(async () => pending.resolve())

    await userEvent.click(screen.getByRole('button', { name: '停止' }))
    expect(onStop).toHaveBeenNthCalledWith(2, 'new')
  })

  it('keeps the delete confirmation lease across session changes', async () => {
    const confirmation = deferred<boolean>()
    vi.mocked(requestConfirm).mockImplementationOnce(() => confirmation.promise)
    const onDelete = vi.fn()
    const props = dialogProps({ onDelete, tunnels: [tunnel('old', 'session-1')] })
    const view = render(<TunnelDialog {...props} />)
    await userEvent.click(screen.getByRole('button', { name: '删除' }))

    view.rerender(<TunnelDialog {...props} sessionId="session-2" tunnels={[tunnel('new', 'session-2')]} />)

    expect(screen.getByRole('button', { name: '删除' })).toBeDisabled()
    await act(async () => confirmation.resolve(true))
    expect(onDelete).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(onDelete).toHaveBeenCalledWith('new')
  })

  it('disables the dialog while another entry point mutates the same session', async () => {
    const pending = deferred<void>()
    const lease = runTunnelMutation('session-1', () => pending.promise)
    const props = dialogProps({ tunnels: [tunnel('old', 'session-1')] })
    render(<TunnelDialog {...props} />)

    expect(screen.getByRole('button', { name: '新建隧道' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '停止' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '删除' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(props.onOpenChange).toHaveBeenCalledWith(false)

    await act(async () => { pending.resolve(); await lease })
    await waitFor(() => expect(screen.getByRole('button', { name: '新建隧道' })).toBeEnabled())
  })
})

function dialogProps(overrides: Partial<Parameters<typeof TunnelDialog>[0]> = {}) {
  return {
    open: true,
    onOpenChange: vi.fn(),
    tunnels: [] as Tunnel[],
    onStart: vi.fn(),
    onStop: vi.fn(),
    onDelete: vi.fn(),
    sessionId: 'session-1',
    ...overrides,
  }
}

function tunnel(id: string, sessionId: string): Tunnel {
  return { id, sessionId, type: 'local', localAddress: '127.0.0.1', localPort: 8080,
    remoteAddress: 'example.com', remotePort: 80, running: true }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
