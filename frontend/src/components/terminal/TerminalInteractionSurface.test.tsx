import { createRef, type ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'

const interactions = vi.hoisted(() => ({
  copyTerminalSelection: vi.fn(),
  pasteClipboardIntoTerminal: vi.fn(),
  selectAllTerminal: vi.fn(),
}))
const loggerError = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => vi.fn())

vi.mock('@/lib/terminalInteractions', () => interactions)
vi.mock('@/lib/logger', () => ({ logger: { error: loggerError } }))
vi.mock('@/components/ui/toast', () => ({ toast }))
vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children, disabled }: { children: ReactNode; disabled?: boolean }) => (
    <div data-testid="context-menu" data-disabled={disabled}>{children}</div>
  ),
  ContextMenuTrigger: ({ children, className, onContextMenuCapture }: {
    children: ReactNode
    className?: string
    onContextMenuCapture?: React.MouseEventHandler<HTMLDivElement>
  }) => <div data-testid="context-menu-trigger" className={className} onContextMenuCapture={onContextMenuCapture}>{children}</div>,
  ContextMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuItem: ({ children, disabled, onClick }: {
    children: ReactNode
    disabled?: boolean
    onClick?: React.MouseEventHandler<HTMLButtonElement>
  }) => <button type="button" disabled={disabled} onClick={onClick}>{children}</button>,
}))

import { TerminalInteractionSurface } from '@/components/terminal/TerminalInteractionSurface'

function createTerminal(selection = 'selected') {
  let currentSelection = selection
  const terminal = {
    focus: vi.fn(),
    getSelection: vi.fn(() => currentSelection),
    paste: vi.fn(),
    selectAll: vi.fn(),
  }
  const terminalRef = createRef<never>()
  terminalRef.current = terminal as never
  return { terminal, terminalRef, setSelection: (value: string) => { currentSelection = value } }
}

describe('TerminalInteractionSurface', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    interactions.copyTerminalSelection.mockResolvedValue(true)
    interactions.pasteClipboardIntoTerminal.mockResolvedValue(undefined)
    useTerminalBehaviorStore.setState({ rightClickAction: 'menu', copyOnSelect: false })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: vi.fn(async () => 'clipboard'), writeText: vi.fn(async () => {}) },
    })
  })

  it('renders the shadcn menu without disabling xterm text selection', () => {
    const { terminalRef } = createTerminal()

    render(<TerminalInteractionSurface terminalRef={terminalRef}><div>terminal</div></TerminalInteractionSurface>)

    expect(screen.getByRole('button', { name: '复制' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '粘贴' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '全选' })).toBeInTheDocument()
    expect(screen.getByTestId('context-menu-trigger')).toHaveClass('select-text', 'bg-background', 'text-foreground')
  })

  it('disables copy when the current terminal selection is empty', () => {
    const { terminalRef, setSelection } = createTerminal('selected')
    render(<TerminalInteractionSurface terminalRef={terminalRef}><div>terminal</div></TerminalInteractionSurface>)

    setSelection('')
    fireEvent.contextMenu(screen.getByTestId('context-menu-trigger'))

    expect(screen.getByRole('button', { name: '复制' })).toBeDisabled()
  })

  it('runs menu helpers with the live terminal and restores focus', async () => {
    const { terminal, terminalRef } = createTerminal()
    render(<TerminalInteractionSurface terminalRef={terminalRef}><div>terminal</div></TerminalInteractionSurface>)
    fireEvent.contextMenu(screen.getByTestId('context-menu-trigger'))

    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    fireEvent.click(screen.getByRole('button', { name: '粘贴' }))
    fireEvent.click(screen.getByRole('button', { name: '全选' }))

    await waitFor(() => expect(terminal.focus).toHaveBeenCalledTimes(3))
    expect(interactions.copyTerminalSelection).toHaveBeenCalledWith(terminal, navigator.clipboard)
    expect(interactions.pasteClipboardIntoTerminal).toHaveBeenCalledWith(terminal, navigator.clipboard)
    expect(interactions.selectAllTerminal).toHaveBeenCalledWith(terminal)
  })

  it('prevents the native menu and pastes directly in paste mode', async () => {
    useTerminalBehaviorStore.setState({ rightClickAction: 'paste', copyOnSelect: false })
    const { terminal, terminalRef } = createTerminal()
    render(<TerminalInteractionSurface terminalRef={terminalRef}><div>terminal</div></TerminalInteractionSurface>)
    const surface = screen.getByText('terminal').parentElement!
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })

    fireEvent(surface, event)

    expect(event.defaultPrevented).toBe(true)
    expect(screen.getByTestId('context-menu')).toHaveAttribute('data-disabled', 'true')
    expect(screen.queryByRole('button', { name: '复制' })).not.toBeInTheDocument()
    await waitFor(() => expect(interactions.pasteClipboardIntoTerminal).toHaveBeenCalledWith(terminal, navigator.clipboard))
    expect(terminal.focus).toHaveBeenCalledOnce()
  })

  it('logs and toasts explicit clipboard failures', async () => {
    useTerminalBehaviorStore.setState({ rightClickAction: 'paste', copyOnSelect: false })
    const error = new Error('clipboard denied')
    interactions.pasteClipboardIntoTerminal.mockRejectedValueOnce(error)
    const { terminalRef } = createTerminal()
    render(<TerminalInteractionSurface terminalRef={terminalRef}><div>terminal</div></TerminalInteractionSurface>)

    fireEvent.contextMenu(screen.getByText('terminal').parentElement!)

    await waitFor(() => expect(loggerError).toHaveBeenCalledWith('terminal clipboard action failed', error))
    expect(toast).toHaveBeenCalledWith('剪贴板操作失败: clipboard denied', 'error')
  })

  it('hot-switches an already mounted surface between menu and paste modes', () => {
    const { terminalRef } = createTerminal()
    render(<TerminalInteractionSurface terminalRef={terminalRef}><div>terminal</div></TerminalInteractionSurface>)
    expect(screen.getByRole('button', { name: '复制' })).toBeInTheDocument()

    act(() => useTerminalBehaviorStore.getState().setSettings({ rightClickAction: 'paste', copyOnSelect: false }))

    expect(screen.queryByRole('button', { name: '复制' })).not.toBeInTheDocument()
    expect(screen.getByText('terminal').parentElement).toHaveClass('bg-background', 'text-foreground')

    act(() => useTerminalBehaviorStore.getState().setSettings({ rightClickAction: 'menu', copyOnSelect: false }))

    expect(screen.getByRole('button', { name: '复制' })).toBeInTheDocument()
    expect(screen.getByTestId('context-menu-trigger')).toHaveClass('select-text')
  })

  it('preserves the mounted terminal container across mode switches', () => {
    const { terminalRef } = createTerminal()
    render(
      <TerminalInteractionSurface terminalRef={terminalRef}>
        <div data-testid="terminal-container">terminal</div>
      </TerminalInteractionSurface>,
    )
    const terminalContainer = screen.getByTestId('terminal-container')

    act(() => useTerminalBehaviorStore.getState().setSettings({ rightClickAction: 'paste', copyOnSelect: false }))
    expect(screen.getByTestId('terminal-container')).toBe(terminalContainer)

    act(() => useTerminalBehaviorStore.getState().setSettings({ rightClickAction: 'menu', copyOnSelect: false }))
    expect(screen.getByTestId('terminal-container')).toBe(terminalContainer)
  })
})
