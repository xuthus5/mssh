import { render, screen, waitFor } from '@testing-library/react'
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
})
