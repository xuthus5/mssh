import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandHistoryRow } from '@/components/terminal/CommandHistoryRow'
import { TooltipProvider } from '@/components/ui/tooltip'

let triggerResize = () => {}

describe('CommandHistoryRow', () => {
  beforeEach(() => {
    triggerResize = () => {}
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        triggerResize = () => callback([], this as unknown as ResizeObserver)
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    })
  })

  it('keeps the command and four actions in one compact row', () => {
    renderRow('git status')

    const row = screen.getByTestId('command-history-row')
    expect(row).toHaveClass('flex', 'items-center')
    expect(row).toHaveStyle({ height: '38px' })
    expect(screen.getByText('git status')).toHaveClass('truncate', 'flex-1')
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      '执行', '填入终端', '复制', '保存为宏',
    ])
  })

  it('shows the full command tooltip only when the command overflows', async () => {
    renderRow('echo a very long command')
    const command = screen.getByText('echo a very long command')
    let clientWidth = 120
    let scrollWidth = 120
    Object.defineProperty(command, 'clientWidth', { configurable: true, get: () => clientWidth })
    Object.defineProperty(command, 'scrollWidth', { configurable: true, get: () => scrollWidth })

    act(() => triggerResize())
    const row = screen.getByTestId('command-history-row')
    await userEvent.hover(row)
    expect(row).not.toHaveAttribute('data-popup-open')
    await userEvent.unhover(row)

    clientWidth = 80
    scrollWidth = 240
    act(() => triggerResize())
    await userEvent.hover(row)
    expect(row).toHaveAttribute('data-popup-open')
    expect(screen.getAllByText('echo a very long command')).toHaveLength(2)
  })
})

function renderRow(command: string) {
  return render(<TooltipProvider><CommandHistoryRow
    entry={{ id: '1', command, createdAt: 1 }}
    start={0}
    height={38}
    macroBusy={false}
    onCopy={vi.fn(async () => {})}
    onExecute={vi.fn(async () => {})}
    onFill={vi.fn()}
    onSaveMacro={vi.fn()}
  /></TooltipProvider>)
}
