import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SerialSignalToolbar } from '@/components/terminal/SerialSignalToolbar'
import { toast } from '@/components/ui/toast'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'

vi.mock('@/components/ui/toast', () => ({ toast: vi.fn() }))

const terminal = 'github.com/xuthus5/mssh/internal/service.TerminalService.'

describe('SerialSignalToolbar', () => {
  beforeEach(() => {
    vi.useRealTimers()
    __clearHandlers()
    __registerHandler(terminal + 'SerialSignals', async () => ({
      dtr: true, rts: false, cts: true, dsr: false, dcd: true, ri: false,
    }))
    __registerHandler(terminal + 'SerialSetSignals', async () => undefined)
    __registerHandler(terminal + 'SerialBreak', async () => undefined)
  })

  it('loads output and input signals and sends break', async () => {
    const user = userEvent.setup()
    render(<SerialSignalToolbar terminalID="term-1" />)
    await waitFor(() => expect(screen.getByText('DTR')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('modem-cts')).toBeInTheDocument())
    expect(screen.getByTestId('modem-dcd')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Break' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Break' })).toBeEnabled())
  })

  it('stops polling and disables controls when the terminal is gone', async () => {
    vi.useFakeTimers()
    let calls = 0
    __registerHandler(terminal + 'SerialSignals', async () => {
      calls += 1
      if (calls === 1) {
        return { dtr: true, rts: true, cts: false, dsr: false, dcd: false, ri: false }
      }
      throw new Error('terminal not found')
    })
    render(<SerialSignalToolbar terminalID="term-gone" />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(calls).toBe(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })
    expect(calls).toBe(2)
    const afterGone = calls
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(calls).toBe(afterGone)
    expect(screen.getByRole('button', { name: 'Break' })).toBeDisabled()
    vi.useRealTimers()
  })

  it('shows serial signal and break failures inline without error toast', async () => {
    const user = userEvent.setup()
    vi.mocked(toast).mockClear()
    __registerHandler(terminal + 'SerialSetSignals', async () => { throw new Error('set failed') })
    __registerHandler(terminal + 'SerialBreak', async () => { throw new Error('break failed') })
    render(<SerialSignalToolbar terminalID="term-1" />)
    await waitFor(() => expect(screen.getByText('DTR')).toBeInTheDocument())
    const switches = screen.getAllByRole('switch')
    await user.click(switches[0])
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('设置串口信号失败: set failed'))
    expect(toast).not.toHaveBeenCalledWith(expect.stringContaining('设置串口信号失败'), 'error')
    await user.click(screen.getByRole('button', { name: 'Break' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('发送 Break 失败: break failed'))
    expect(vi.mocked(toast).mock.calls.filter((call) => call[1] === 'error')).toHaveLength(0)
  })

  it('does not overlap slow signal polls', async () => {
    vi.useFakeTimers()
    const pending: Array<(value: { dtr: boolean; rts: boolean; cts: boolean; dsr: boolean; dcd: boolean; ri: boolean }) => void> = []
    __registerHandler(terminal + 'SerialSignals', () => new Promise((resolve) => { pending.push(resolve) }))
    render(<SerialSignalToolbar terminalID="term-1" />)

    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(pending).toHaveLength(1)
    await act(async () => {
      pending[0]({ dtr: false, rts: false, cts: true, dsr: true, dcd: false, ri: true })
      await Promise.resolve()
    })
    expect(screen.getAllByRole('switch')[0]).not.toBeChecked()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(pending).toHaveLength(2)
    vi.useRealTimers()
  })

  it('does not paint an old signal action after switching terminals', async () => {
    const user = userEvent.setup()
    let rejectSet: ((reason?: unknown) => void) | undefined
    __registerHandler(terminal + 'SerialSetSignals', () => new Promise((_, reject) => { rejectSet = reject }))
    const view = render(<SerialSignalToolbar terminalID="term-1" />)
    await waitFor(() => expect(screen.getByText('DTR')).toBeInTheDocument())
    await user.click(screen.getAllByRole('switch')[0])
    view.rerender(<SerialSignalToolbar terminalID="term-2" />)
    await act(async () => {
      rejectSet?.(new Error('old terminal action failed'))
      await Promise.resolve()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('deduplicates rapid signal mutations before pending state renders', async () => {
    const pending = deferred<void>()
    const setSignals = vi.fn(() => pending.promise)
    __registerHandler(terminal + 'SerialSetSignals', setSignals)
    render(<SerialSignalToolbar terminalID="term-1" />)
    await waitFor(() => expect(screen.getAllByRole('switch')[0]).toBeChecked())

    const signal = screen.getAllByRole('switch')[0]
    act(() => {
      fireEvent.click(signal)
      fireEvent.click(signal)
    })
    expect(setSignals).toHaveBeenCalledOnce()
    await act(async () => pending.resolve())
  })

  it('keeps the signal mutation lease across terminal changes', async () => {
    const pending = deferred<void>()
    const setSignals = vi.fn(() => pending.promise)
    const sendBreak = vi.fn(async () => undefined)
    __registerHandler(terminal + 'SerialSetSignals', setSignals)
    __registerHandler(terminal + 'SerialBreak', sendBreak)
    const view = render(<SerialSignalToolbar terminalID="term-1" />)
    await waitFor(() => expect(screen.getAllByRole('switch')[0]).toBeChecked())
    await userEvent.click(screen.getAllByRole('switch')[0])

    view.rerender(<SerialSignalToolbar terminalID="term-2" />)
    expect(screen.getByRole('button', { name: 'Break' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Break' }))
    expect(sendBreak).not.toHaveBeenCalled()

    await act(async () => pending.resolve())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Break' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Break' }))
    expect(sendBreak).toHaveBeenCalledOnce()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
