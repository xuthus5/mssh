import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAppStore } from '@/store/appStore'
import { __registerHandler, __clearHandlers } from '@/test/__mocks__/wails-runtime'

describe('appStore', () => {
  beforeEach(() => {
    __clearHandlers()
    useAppStore.setState({
      tabs: [],
      activeTabId: null,
      terminalPool: new Map(),
      connectionStatus: {},
    })
  })

  it('opens and closes tabs', () => {
    const { openTab, closeTab } = useAppStore.getState()
    openTab({ id: 'tab-1', title: 'Test', type: 'terminal' })
    expect(useAppStore.getState().tabs).toHaveLength(1)
    expect(useAppStore.getState().activeTabId).toBe('tab-1')

    closeTab('tab-1')
    expect(useAppStore.getState().tabs).toHaveLength(0)
    expect(useAppStore.getState().activeTabId).toBeNull()
  })

  it('sets active tab', () => {
    const { openTab, setActiveTab } = useAppStore.getState()
    openTab({ id: 'tab-1', title: 'A', type: 'terminal' })
    openTab({ id: 'tab-2', title: 'B', type: 'terminal' })
    setActiveTab('tab-1')
    expect(useAppStore.getState().activeTabId).toBe('tab-1')
  })

  it('registers and unregisters terminals', () => {
    const { registerTerminal, unregisterTerminal } = useAppStore.getState()
    const mockTerminal = { dispose: () => {} } as unknown as import('@xterm/xterm').Terminal
    registerTerminal('term-1', mockTerminal)
    expect(useAppStore.getState().terminalPool.has('term-1')).toBe(true)

    unregisterTerminal('term-1')
    expect(useAppStore.getState().terminalPool.has('term-1')).toBe(false)
  })

  it('removes a remotely closed tab without disposing the React-owned terminal', () => {
    const dispose = vi.fn()
    const terminal = { dispose } as unknown as import('@xterm/xterm').Terminal
    const store = useAppStore.getState()
    store.openTab({ id: 'tab-1', title: 'Test', type: 'terminal', terminalId: 'term-1' })
    store.registerTerminal('term-1', terminal)

    store.removeTabLocal('tab-1')

    expect(dispose).not.toHaveBeenCalled()
    expect(useAppStore.getState().terminalPool.has('term-1')).toBe(false)
  })

  it('updates last used timestamp', () => {
    const { registerTerminal, updateLastUsed } = useAppStore.getState()
    const mockTerminal = { dispose: () => {} } as unknown as import('@xterm/xterm').Terminal
    registerTerminal('term-1', mockTerminal)
    const before = useAppStore.getState().terminalPool.get('term-1')?.lastUsed ?? 0
    updateLastUsed('term-1')
    const after = useAppStore.getState().terminalPool.get('term-1')?.lastUsed ?? 0
    expect(after).toBeGreaterThanOrEqual(before)
  })

  it('sets connection status', () => {
    useAppStore.getState().setConnectionStatus('term-1', 'connected')
    expect(useAppStore.getState().connectionStatus['term-1']).toBe('connected')
  })

  it('evicts LRU when pool exceeds max size', () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.TerminalService.Close', async () => {})
    const { registerTerminal } = useAppStore.getState()
    const makeTerm = () => ({ dispose: () => {} }) as unknown as import('@xterm/xterm').Terminal
    for (let i = 0; i < 35; i++) {
      registerTerminal(`term-${i}`, makeTerm())
    }
    expect(useAppStore.getState().terminalPool.size).toBeLessThanOrEqual(
      useAppStore.getState().maxPoolSize,
    )
  })

  it('manages transfers', () => {
    const { addTransfer, updateTransfer, removeTransfer } = useAppStore.getState()
    addTransfer({
      id: 't1', fileName: 'test.txt', direction: 'upload',
      totalBytes: 100, transferredBytes: 0, speed: 0, eta: 0, status: 'queued', startedAt: Date.now(),
    })
    expect(useAppStore.getState().transfers).toHaveLength(1)
    updateTransfer('t1', { transferredBytes: 50, speed: 1024 })
    expect(useAppStore.getState().transfers[0].transferredBytes).toBe(50)
    removeTransfer('t1')
    expect(useAppStore.getState().transfers).toHaveLength(0)
  })
})
