import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SerialSignalToolbar } from '@/components/terminal/SerialSignalToolbar'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'

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
})
