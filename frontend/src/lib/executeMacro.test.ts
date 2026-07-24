import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeMacroOnActiveTerminal } from '@/lib/executeMacro'
import { useAppStore } from '@/store/appStore'
import { useToastStore } from '@/components/ui/toast'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'

const executePath = 'github.com/xuthus5/mssh/internal/service.MacroService.Execute'
const addHistory = 'github.com/xuthus5/mssh/internal/service.CommandHistoryService.Add'

describe('executeMacroOnActiveTerminal', () => {
  beforeEach(() => {
    __clearHandlers()
    useToastStore.setState({ toasts: [] })
    useAppStore.setState({
      tabs: [],
      connectionStatus: {},
      activeSurface: { type: 'workspace', id: 'macros' },
      activePaneId: null,
    })
    localStorage.clear()
  })

  it('requires a terminal before executing', async () => {
    await executeMacroOnActiveTerminal('uptime')
    expect(useToastStore.getState().toasts.some((item) => item.message.includes('请先连接终端') && item.type === 'info')).toBe(true)
  })

  it('sidebar mode ignores terminals when surface is not a terminal tab', async () => {
    const execute = vi.fn(async () => {})
    __registerHandler(executePath, execute)
    useAppStore.setState({
      tabs: [{ id: 'tab-1', title: 'host', type: 'terminal', terminalId: 'term-1', sessionId: 1 }],
      connectionStatus: { 'term-1': 'connected' },
      activeSurface: { type: 'workspace', id: 'macros' },
    })
    await executeMacroOnActiveTerminal('uptime', { requireTerminalSurface: true })
    expect(execute).not.toHaveBeenCalled()
    expect(useToastStore.getState().toasts.some((item) => item.message.includes('请先连接终端') && item.type === 'info')).toBe(true)
  })

  it('workspace mode can fall back to a connected terminal tab', async () => {
    const execute = vi.fn(async () => {})
    __registerHandler(executePath, execute)
    __registerHandler(addHistory, async () => {})
    useAppStore.setState({
      tabs: [{ id: 'tab-1', title: 'host', type: 'terminal', terminalId: 'term-1', sessionId: 9 }],
      connectionStatus: { 'term-1': 'connected' },
      activeSurface: { type: 'workspace', id: 'macros' },
    })
    await executeMacroOnActiveTerminal('uptime')
    expect(execute).toHaveBeenCalledWith('term-1', 'uptime')
  })

  it('requires a connected target pane', async () => {
    useAppStore.setState({
      tabs: [{ id: 'tab-1', title: 'host', type: 'terminal', terminalId: 'term-1', sessionId: 1, splitPaneIDs: ['term-1', 'term-2'] }],
      connectionStatus: { 'term-1': 'connected', 'term-2': 'disconnected' },
      activeSurface: { type: 'terminal', id: 'tab-1' },
      activePaneId: 'term-2',
    })
    await executeMacroOnActiveTerminal('uptime')
    expect(useToastStore.getState().toasts.some((item) => item.message.includes('当前终端未连接') && item.type === 'warning')).toBe(true)
  })

  it('executes against the active split pane and records history', async () => {
    const execute = vi.fn(async () => {})
    const add = vi.fn(async () => {})
    __registerHandler(executePath, execute)
    __registerHandler(addHistory, add)
    useAppStore.setState({
      tabs: [{ id: 'tab-1', title: 'host', type: 'terminal', terminalId: 'term-1', sessionId: 9, splitPaneIDs: ['term-1', 'term-2'] }],
      connectionStatus: { 'term-1': 'connected', 'term-2': 'connected' },
      activeSurface: { type: 'terminal', id: 'tab-1' },
      activePaneId: 'term-2',
    })
    await executeMacroOnActiveTerminal('uptime')
    expect(execute).toHaveBeenCalledWith('term-2', 'uptime')
    expect(add).toHaveBeenCalledWith(9, 'uptime')
    expect(useToastStore.getState().toasts.some((item) => item.message.includes('宏已发送') && item.type === 'success')).toBe(true)
  })

  it('rethrows execute failures without error toast', async () => {
    __registerHandler(executePath, async () => { throw new Error('boom') })
    useAppStore.setState({
      tabs: [{ id: 'tab-1', title: 'host', type: 'terminal', terminalId: 'term-1', sessionId: 1 }],
      connectionStatus: { 'term-1': 'connected' },
      activeSurface: { type: 'terminal', id: 'tab-1' },
    })
    await expect(executeMacroOnActiveTerminal('uptime')).rejects.toThrow('boom')
    expect(useToastStore.getState().toasts.filter((item) => item.type === 'error')).toHaveLength(0)
  })
})
