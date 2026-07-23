import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listMacros = vi.fn()
const executeMacro = vi.fn()
const toast = vi.fn()

vi.mock('@/components/layout/OverviewContent', () => ({
  OverviewContent: () => <div>总览工作区</div>,
}))

vi.mock('@/lib/wails', () => ({
  MacroService: {
    List: (...args: unknown[]) => listMacros(...args),
    Execute: (...args: unknown[]) => executeMacro(...args),
    Delete: vi.fn(),
  },
}))

vi.mock('@/components/ui/toast', () => ({
  toast: (...args: unknown[]) => toast(...args),
}))

import { executeMacroOnActiveTerminal, WorkspaceContent } from '@/components/layout/WorkspaceContent'
import { useAppStore } from '@/store/appStore'

describe('WorkspaceContent accessibility', () => {
  beforeEach(() => {
    toast.mockReset()
    listMacros.mockReset()
    executeMacro.mockReset()
    useAppStore.setState({
      activeSurface: { type: 'workspace', id: 'sessions' },
      workspaceTab: 'sessions',
      tabs: [],
      connectionStatus: {},
    })
  })

  it('labels the workspace panel from the selected fixed tab', () => {
    render(<WorkspaceContent />)

    const panel = screen.getByRole('region')
    expect(panel).toHaveAttribute('id', 'workspace-panel')
    expect(panel).toHaveAttribute('aria-labelledby', 'workspace-tab-sessions')
  })

  it('renders overview as a dedicated workspace', () => {
    useAppStore.setState({ activeSurface: { type: 'workspace', id: 'overview' } })
    render(<WorkspaceContent />)

    expect(screen.getByText('总览工作区')).toBeInTheDocument()
    expect(screen.getByRole('region')).toHaveAttribute('aria-labelledby', 'workspace-tab-overview')
  })
})

describe('executeMacroOnActiveTerminal', () => {
  beforeEach(() => {
    toast.mockReset()
    executeMacro.mockReset()
    useAppStore.setState({
      tabs: [],
      connectionStatus: {},
      activeSurface: { type: 'workspace', id: 'macros' },
    })
  })

  it('requires a terminal tab before executing', async () => {
    await executeMacroOnActiveTerminal('uptime')
    expect(toast).toHaveBeenCalledWith('请先连接终端后再执行宏', 'info')
    expect(executeMacro).not.toHaveBeenCalled()
  })

  it('requires a connected terminal', async () => {
    useAppStore.setState({
      tabs: [{ id: 'tab-1', title: 'host', type: 'terminal', terminalId: 'term-1', sessionId: 1 }],
      connectionStatus: { 'term-1': 'connecting' },
      activeSurface: { type: 'terminal', id: 'tab-1' },
    })
    await executeMacroOnActiveTerminal('uptime')
    expect(toast).toHaveBeenCalledWith('当前终端未连接，无法执行宏', 'warning')
    expect(executeMacro).not.toHaveBeenCalled()
  })

  it('executes against the active terminal tab', async () => {
    executeMacro.mockResolvedValue(undefined)
    useAppStore.setState({
      tabs: [{ id: 'tab-1', title: 'host', type: 'terminal', terminalId: 'term-1', sessionId: 1 }],
      connectionStatus: { 'term-1': 'connected' },
      activeSurface: { type: 'terminal', id: 'tab-1' },
    })
    await executeMacroOnActiveTerminal('uptime\n')
    expect(executeMacro).toHaveBeenCalledWith('term-1', 'uptime\n')
    expect(toast).toHaveBeenCalledWith('宏已发送到活动终端', 'success')
  })

  it('surfaces execute failures', async () => {
    executeMacro.mockRejectedValue(new Error('boom'))
    useAppStore.setState({
      tabs: [{ id: 'tab-1', title: 'host', type: 'terminal', terminalId: 'term-1', sessionId: 1 }],
      connectionStatus: { 'term-1': 'connected' },
      activeSurface: { type: 'terminal', id: 'tab-1' },
    })
    await executeMacroOnActiveTerminal('uptime')
    expect(toast).toHaveBeenCalledWith('执行宏失败: boom', 'error')
  })
})

describe('MacrosWorkspace execute path', () => {
  beforeEach(() => {
    toast.mockReset()
    listMacros.mockReset()
    executeMacro.mockReset()
    listMacros.mockResolvedValue([{ id: 7, name: 'Uptime', shortcut: '', command: 'uptime' }])
    executeMacro.mockResolvedValue(undefined)
    useAppStore.setState({
      activeSurface: { type: 'workspace', id: 'macros' },
      workspaceTab: 'macros',
      tabs: [{ id: 'tab-1', title: 'host', type: 'terminal', terminalId: 'term-1', sessionId: 1 }],
      connectionStatus: { 'term-1': 'connected' },
    })
  })

  it('sends the selected macro to the active terminal', async () => {
    const user = userEvent.setup()
    render(<WorkspaceContent />)
    expect(await screen.findByText('Uptime')).toBeInTheDocument()
    await user.click(screen.getByText('Uptime'))
    await waitFor(() => {
      expect(executeMacro).toHaveBeenCalledWith('term-1', 'uptime')
    })
  })

  it('toasts macro list failures', async () => {
    listMacros.mockRejectedValueOnce(new Error('list macros failed'))
    render(<WorkspaceContent />)
    expect(await screen.findByText('list macros failed')).toBeInTheDocument()
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('list macros failed'), 'error')
  })
})
