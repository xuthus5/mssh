import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listMacros = vi.fn()
const executeMacro = vi.fn()
const deleteMacro = vi.fn()
const toast = vi.fn()

vi.mock('@/components/layout/OverviewContent', () => ({
  OverviewContent: () => <div>总览工作区</div>,
}))

vi.mock('@/lib/wails', () => ({
  MacroService: {
    List: (...args: unknown[]) => listMacros(...args),
    Execute: (...args: unknown[]) => executeMacro(...args),
    Delete: (...args: unknown[]) => deleteMacro(...args),
  },
  CommandHistoryService: {
    Add: vi.fn(async () => {}),
    Clear: vi.fn(async () => {}),
  },
}))

vi.mock('@/components/ui/toast', () => ({
  toast: (...args: unknown[]) => toast(...args),
}))

vi.mock('@/lib/confirmDialog', () => ({ requestConfirm: vi.fn(async () => true) }))

import { executeMacroOnActiveTerminal, WorkspaceContent } from '@/components/layout/WorkspaceContent'
import { useAppStore } from '@/store/appStore'
import { useMacroMutationState } from '@/lib/macroMutationCoordinator'

describe('WorkspaceContent accessibility', () => {
  beforeEach(() => {
    toast.mockReset()
    listMacros.mockReset()
    executeMacro.mockReset()
    deleteMacro.mockReset().mockResolvedValue(undefined)
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
    await expect(executeMacroOnActiveTerminal('uptime')).rejects.toThrow('boom')
    expect(toast).not.toHaveBeenCalledWith('执行宏失败: boom', 'error')
  })
})

describe('MacrosWorkspace execute path', () => {
  beforeEach(() => {
    toast.mockReset()
    listMacros.mockReset()
    executeMacro.mockReset()
    deleteMacro.mockReset().mockResolvedValue(undefined)
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

  it('shows macro list failures inline without toast', async () => {
    listMacros.mockRejectedValueOnce(new Error('list macros failed'))
    render(<WorkspaceContent />)
    expect(await screen.findByText('list macros failed')).toBeInTheDocument()
    expect(await screen.findByText('宏加载失败')).toBeInTheDocument()
    expect(toast).not.toHaveBeenCalled()
  })

  it('shows macro delete failures inline without toast', async () => {
    listMacros.mockResolvedValueOnce([{ id: 1, name: 'Uptime', shortcut: '', command: 'uptime' }])
    deleteMacro.mockRejectedValueOnce(new Error('delete macros failed'))
    const user = userEvent.setup()
    render(<WorkspaceContent />)
    expect(await screen.findByText('Uptime')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '删除 Uptime' }))
    expect(await screen.findByText('删除宏失败: delete macros failed')).toBeInTheDocument()
    expect(await screen.findByText('Uptime')).toBeInTheDocument()
    expect(toast).not.toHaveBeenCalled()
  })

  it('shows macro execute failures inline without toast', async () => {
    executeMacro.mockRejectedValueOnce(new Error('execute macros failed'))
    const user = userEvent.setup()
    render(<WorkspaceContent />)
    expect(await screen.findByText('Uptime')).toBeInTheDocument()
    await user.click(screen.getByText('Uptime'))
    expect(await screen.findByText('执行宏失败: execute macros failed')).toBeInTheDocument()
    expect(toast).not.toHaveBeenCalled()
  })

  it('prevents duplicate manual macro refreshes while keeping the current list visible', async () => {
    let resolveRefresh: ((items: Array<{ id: number; name: string; command: string }>) => void) | undefined
    listMacros.mockReset()
      .mockResolvedValueOnce([{ id: 0, name: 'initial macro', command: 'initial' }])
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve }))
    render(<WorkspaceContent />)
    expect(await screen.findByText('initial macro')).toBeInTheDocument()
    const refresh = screen.getByRole('button', { name: '刷新' })
    await userEvent.click(refresh)
    expect(refresh).toBeDisabled()
    expect(screen.getByText('initial macro')).toBeInTheDocument()
    await userEvent.click(refresh)
    expect(listMacros).toHaveBeenCalledTimes(2)
    await act(async () => { resolveRefresh?.([{ id: 2, name: 'new macro', command: 'new' }]) })
    expect(await screen.findByText('new macro')).toBeInTheDocument()
  })

  it('rejects same-frame duplicate macro refreshes before loading state renders', async () => {
    const refresh = deferred<Array<{ id: number; name: string; command: string }>>()
    listMacros.mockReset()
      .mockResolvedValueOnce([{ id: 0, name: 'initial macro', command: 'initial' }])
      .mockImplementationOnce(() => refresh.promise)
    render(<WorkspaceContent />)
    expect(await screen.findByText('initial macro')).toBeInTheDocument()

    const refreshButton = screen.getByRole('button', { name: '刷新' })
    act(() => {
      fireEvent.click(refreshButton)
      fireEvent.click(refreshButton)
    })

    expect(listMacros).toHaveBeenCalledTimes(2)
    await act(async () => refresh.resolve([{ id: 2, name: 'new macro', command: 'new' }]))
  })

  it('waits for an active macro refresh before deleting and reloads afterward', async () => {
    const refresh = deferred<Array<{ id: number; name: string; command: string }>>()
    listMacros.mockReset()
      .mockResolvedValueOnce([{ id: 7, name: 'Uptime', command: 'uptime' }])
      .mockImplementationOnce(() => refresh.promise)
      .mockResolvedValueOnce([])
    render(<WorkspaceContent />)
    expect(await screen.findByText('Uptime')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    fireEvent.click(screen.getByRole('button', { name: '删除 Uptime' }))
    await waitFor(() => expect(deleteMacro).not.toHaveBeenCalled())
    await waitFor(() => expect(useMacroMutationState.getState().busy).toBe(true))

    await act(async () => refresh.resolve([{ id: 7, name: 'Uptime', command: 'uptime' }]))
    await waitFor(() => expect(deleteMacro).toHaveBeenCalledWith(7))
    await waitFor(() => expect(listMacros).toHaveBeenCalledTimes(3))
  })

  it('keeps a pending macro deletion locked across workspace changes', async () => {
    const deleting = deferred<void>()
    deleteMacro.mockImplementationOnce(() => deleting.promise)
    render(<WorkspaceContent />)
    await userEvent.click(await screen.findByRole('button', { name: '删除 Uptime' }))
    await waitFor(() => expect(deleteMacro).toHaveBeenCalledOnce())

    act(() => useAppStore.setState({
      activeSurface: { type: 'workspace', id: 'sessions' }, workspaceTab: 'sessions',
    }))
    act(() => useAppStore.setState({
      activeSurface: { type: 'workspace', id: 'macros' }, workspaceTab: 'macros',
    }))
    const remove = await screen.findByRole('button', { name: '删除 Uptime' })
    expect(remove).toBeDisabled()
    await userEvent.click(remove)
    expect(deleteMacro).toHaveBeenCalledOnce()

    await act(async () => { deleting.resolve(); await deleting.promise })
    await waitFor(() => expect(remove).toBeEnabled())
  })

})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}
