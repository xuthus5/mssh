import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAppStore } from '@/store/appStore'
import { canTransitionConnection } from '@/store/appStoreActions'
import { __registerHandler, __clearHandlers } from '@/test/__mocks__/wails-runtime'

describe('appStore', () => {
  beforeEach(() => {
    __clearHandlers()
    localStorage.clear()
    useAppStore.setState({
      tabs: [],
      activeSurface: null,
      workspaceTab: 'sessions',
      overviewSection: 'sessions',
      overviewReturnSurface: null,
      navigationCollapsed: false,
      sidebarWidth: 280,
      focusRequest: { id: '', sequence: 0 },
      terminalPool: new Map(),
      connectionStatus: {},
      transfers: [],
      transferCenterOpen: false,
    })
  })

  it('uses activeSurface as the only activation state', () => {
    expect(useAppStore.getState()).not.toHaveProperty('activeTabId')
    expect(useAppStore.getState()).not.toHaveProperty('sidebarTab')
    expect(useAppStore.getState()).not.toHaveProperty('hasEnteredWorkspace')
  })

  it('opens and closes tabs', async () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.TerminalService.Close', async () => {})
    const { openTab, closeTab } = useAppStore.getState()
    openTab({ id: 'tab-1', title: 'Test', type: 'terminal', terminalId: 'term-1', sessionId: 1 })
    expect(useAppStore.getState().tabs).toHaveLength(1)
    expect(useAppStore.getState().activeSurface).toEqual({ type: 'terminal', id: 'tab-1' })

    await closeTab('tab-1')
    expect(useAppStore.getState().tabs).toHaveLength(0)
    expect(useAppStore.getState().activeSurface).toEqual({ type: 'workspace', id: 'sessions' })
  })

  it('opens the selected workspace from the welcome surface', () => {
    const store = useAppStore.getState()

    store.activateWorkspace('sessions')
    expect(useAppStore.getState().activeSurface).toEqual({ type: 'workspace', id: 'sessions' })
    expect(useAppStore.getState().workspaceTab).toBe('sessions')

    store.openTab({ id: 'terminal-1', title: 'one', type: 'terminal', terminalId: 'term-1', sessionId: 1 })
    expect(useAppStore.getState().activeSurface).toEqual({ type: 'terminal', id: 'terminal-1' })
  })

  it('keeps the active terminal visible when opening the macro sidebar', () => {
    const store = useAppStore.getState()
    store.openTab({ id: 'terminal-1', title: 'one', type: 'terminal', terminalId: 'term-1', sessionId: 1 })

    store.activateWorkspace('macros')

    expect(useAppStore.getState()).toMatchObject({
      activeSurface: { type: 'terminal', id: 'terminal-1' },
      workspaceTab: 'macros',
    })

    store.activateWorkspace('sessions')
    expect(useAppStore.getState()).toMatchObject({
      activeSurface: { type: 'terminal', id: 'terminal-1' },
      workspaceTab: 'sessions',
    })
  })

  it('restores the previous surface after leaving overview', () => {
    const store = useAppStore.getState()
    store.openTab({ id: 'terminal-1', title: 'one', type: 'terminal', terminalId: 'term-1', sessionId: 1 })

    store.activateWorkspace('overview')
    store.setOverviewSection('keys')

    expect(useAppStore.getState()).toMatchObject({
      activeSurface: { type: 'workspace', id: 'overview' },
      overviewSection: 'keys',
      overviewReturnSurface: { type: 'terminal', id: 'terminal-1' },
    })
    store.leaveOverview()
    expect(useAppStore.getState()).toMatchObject({
      activeSurface: { type: 'terminal', id: 'terminal-1' },
      overviewReturnSurface: null,
    })
  })

  it('falls back right, left, then sessions when closing the active tab', async () => {
    const store = useAppStore.getState()
    store.openTab({ id: 'a', title: 'A', type: 'playback', recordingPath: '/tmp/a.msshlog' })
    store.openTab({ id: 'b', title: 'B', type: 'playback', recordingPath: '/tmp/b.msshlog' })
    store.openTab({ id: 'c', title: 'C', type: 'playback', recordingPath: '/tmp/c.msshlog' })

    store.activateTab('b')
    await store.closeTab('b')
    expect(useAppStore.getState().activeSurface).toEqual({ type: 'playback', id: 'c' })

    await store.closeTab('c')
    expect(useAppStore.getState().activeSurface).toEqual({ type: 'playback', id: 'a' })

    await store.closeTab('a')
    expect(useAppStore.getState().activeSurface).toEqual({ type: 'workspace', id: 'sessions' })
  })

  it('syncs workspaceTab when the last dynamic tab falls back from macros to sessions', async () => {
    const store = useAppStore.getState()
    store.activateWorkspace('macros')
    store.openTab({ id: 'playback-1', title: 'Playback', type: 'playback', recordingPath: '/tmp/playback-1.msshlog' })

    await store.closeTab('playback-1')

    expect(useAppStore.getState()).toMatchObject({
      activeSurface: { type: 'workspace', id: 'sessions' },
      workspaceTab: 'sessions',
    })
  })

  it('tracks explicit terminal focus requests', () => {
    const store = useAppStore.getState()
    store.openTab({ id: 'terminal-1', title: 'one', type: 'terminal', terminalId: 'term-1', sessionId: 1 })

    store.activateTab('terminal-1', true)

    expect(useAppStore.getState()).toMatchObject({
      activeSurface: { type: 'terminal', id: 'terminal-1' },
      focusRequest: { id: 'terminal-1', sequence: 1 },
    })
  })

  it('atomically activates a terminal pane and requests focus', () => {
    const store = useAppStore.getState()
    store.openTab({ id: 'terminal-1', title: 'one', type: 'terminal', terminalId: 'primary-1', sessionId: 1 })

    store.requestTerminalFocus('terminal-1', 'split-1')

    expect(useAppStore.getState()).toMatchObject({
      activeSurface: { type: 'terminal', id: 'terminal-1' },
      activePaneId: 'split-1',
      focusRequest: { id: 'terminal-1', terminalId: 'split-1', sequence: 1 },
    })
  })

  it('preserves the active split across a workspace round trip', () => {
    const store = useAppStore.getState()
    store.openTab({ id: 'terminal-1', title: 'one', type: 'terminal', terminalId: 'primary-1', sessionId: 1 })
    store.requestTerminalFocus('terminal-1', 'split-1')

    store.activateWorkspace('sessions')
    store.activateTab('terminal-1', true)

    expect(useAppStore.getState()).toMatchObject({
      activeSurface: { type: 'terminal', id: 'terminal-1' },
      activePaneId: 'split-1',
      focusRequest: { id: 'terminal-1', terminalId: 'split-1', sequence: 2 },
    })
  })

  it('persists shared navigation state', () => {
    const store = useAppStore.getState()

    store.toggleNavigation()
    store.setSidebarWidth(320)

    expect(useAppStore.getState()).toMatchObject({ navigationCollapsed: true, sidebarWidth: 320 })
    expect(localStorage.getItem('mssh:sidebar-collapsed')).toBe('true')
    expect(localStorage.getItem('mssh:sidebar-width')).toBe('320')
  })

  it('restores and clamps the persisted sidebar width at startup', async () => {
    localStorage.setItem('mssh:sidebar-width', '999')
    vi.resetModules()

    const { useAppStore: freshAppStore } = await import('@/store/appStore')

    expect(freshAppStore.getState().sidebarWidth).toBe(480)
  })

  it.each([
    [Number.NaN, 280],
    [Number.POSITIVE_INFINITY, 480],
    [Number.NEGATIVE_INFINITY, 220],
    [-1, 220],
    [219, 220],
    [481, 480],
  ])('clamps invalid sidebar width %s to %s', (input, expected) => {
    useAppStore.getState().setSidebarWidth(input)

    expect(useAppStore.getState().sidebarWidth).toBe(expected)
    expect(localStorage.getItem('mssh:sidebar-width')).toBe(String(expected))
  })

  it('keeps a terminal tab open when closing it fails', async () => {
    __registerHandler(
      'github.com/xuthus5/mssh/internal/service.TerminalService.Close',
      async () => { throw new Error('connection lost') },
    )
    const store = useAppStore.getState()
    store.openTab({ id: 'terminal-1', title: 'one', type: 'terminal', terminalId: 'term-1', sessionId: 1 })

    await expect(store.closeTab('terminal-1')).rejects.toThrow('connection lost')

    expect(useAppStore.getState().tabs).toHaveLength(1)
  })

  it('removes a terminal tab already closed by the backend', async () => {
    __registerHandler(
      'github.com/xuthus5/mssh/internal/service.TerminalService.Close',
      async () => { throw new Error('terminal term-1 not found') },
    )
    const store = useAppStore.getState()
    store.openTab({ id: 'terminal-1', title: 'one', type: 'terminal', terminalId: 'term-1', sessionId: 1 })

    await store.closeTab('terminal-1')

    expect(useAppStore.getState()).toMatchObject({
      tabs: [],
      activeSurface: { type: 'workspace', id: 'sessions' },
    })
  })

  it('closes playback tabs locally without closing a backend terminal', () => {
    const closeTerminal = vi.fn(async () => {})
    __registerHandler('github.com/xuthus5/mssh/internal/service.TerminalService.Close', closeTerminal)
    const { openTab, closeTab } = useAppStore.getState()
    openTab({ id: 'playback-1', title: '回放 #1', type: 'playback', recordingPath: 'C:\\Users\\xuthu\\recording.msshlog' })

    closeTab('playback-1')

    expect(closeTerminal).not.toHaveBeenCalled()
    expect(useAppStore.getState().tabs).toHaveLength(0)
  })

  it('sets active tab', () => {
    const { openTab, activateTab } = useAppStore.getState()
    openTab({ id: 'tab-1', title: 'A', type: 'terminal', terminalId: 'term-1', sessionId: 1 })
    openTab({ id: 'tab-2', title: 'B', type: 'terminal', terminalId: 'term-2', sessionId: 2 })
    activateTab('tab-1')
    expect(useAppStore.getState().activeSurface).toEqual({ type: 'terminal', id: 'tab-1' })
  })

  it('updates persistent terminal workspace state', () => {
    const store = useAppStore.getState()
    store.openTab({ id: 'tab-1', title: 'A', type: 'terminal', terminalId: 'term-1', sessionId: 1 })

    store.updateTerminalWorkspace('tab-1', { toolPanel: 'history' })

    expect(useAppStore.getState().tabs[0]).toMatchObject({ toolPanel: 'history' })
  })

  it('promotes an existing split terminal without replacing its pooled instance', () => {
    const primary = { dispose: vi.fn() } as unknown as import('@xterm/xterm').Terminal
    const sibling = { dispose: vi.fn() } as unknown as import('@xterm/xterm').Terminal
    const store = useAppStore.getState()
    store.openTab({ id: 'tab-1', title: 'A', type: 'terminal', terminalId: 'primary-1', sessionId: 1 })
    store.registerTerminal('primary-1', primary)
    store.registerTerminal('split-1', sibling)
    store.setActivePane('primary-1')

    expect(store.promoteTerminalConnection('tab-1', 'primary-1', 'split-1')).toBe(true)

    const state = useAppStore.getState()
    expect(state.tabs[0]).toMatchObject({ terminalId: 'split-1' })
    expect(state.terminalPool.get('split-1')?.terminal).toBe(sibling)
    expect(state.terminalPool.has('primary-1')).toBe(false)
    expect(state.activePaneId).toBe('split-1')
  })

  it('registers and unregisters terminals', () => {
    const { registerTerminal, unregisterTerminal } = useAppStore.getState()
    const mockTerminal = { dispose: () => {} } as unknown as import('@xterm/xterm').Terminal
    registerTerminal('term-1', mockTerminal)
    expect(useAppStore.getState().terminalPool.has('term-1')).toBe(true)

    unregisterTerminal('term-1')
    expect(useAppStore.getState().terminalPool.has('term-1')).toBe(false)
  })

  it('forgets all runtime state for a closed split terminal', () => {
    const terminal = { dispose: vi.fn() } as unknown as import('@xterm/xterm').Terminal
    const store = useAppStore.getState()
    store.registerTerminal('split-1', terminal)
    store.setConnectionStatus('split-1', 'connected')
    store.setRecordingState('split-1', 'recording')
    store.setActivePane('split-1')

    store.forgetTerminal('split-1')

    const state = useAppStore.getState()
    expect(state.terminalPool.has('split-1')).toBe(false)
    expect(state.connectionStatus['split-1']).toBeUndefined()
    expect(state.recordingState['split-1']).toBeUndefined()
    expect(state.activePaneId).toBeNull()
  })

  it('removes a remotely closed tab without disposing the React-owned terminal', () => {
    const dispose = vi.fn()
    const terminal = { dispose } as unknown as import('@xterm/xterm').Terminal
    const store = useAppStore.getState()
    store.openTab({ id: 'tab-1', title: 'Test', type: 'terminal', terminalId: 'term-1', sessionId: 1 })
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

  it('evicts orphan pool entries before closing terminals still bound to open tabs', () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.TerminalService.Close', async () => {})
    const orphanDispose = vi.fn()
    const openDispose = vi.fn()
    const make = (dispose: () => void) => ({ dispose }) as unknown as import('@xterm/xterm').Terminal
    useAppStore.setState({ maxPoolSize: 2, terminalPool: new Map(), tabs: [], activePaneId: null })
    const store = useAppStore.getState()
    store.openTab({ id: 'tab-open', title: 'Open', type: 'terminal', terminalId: 'term-open', sessionId: 1 })
    store.registerTerminal('term-open', make(openDispose))
    store.registerTerminal('term-orphan', make(orphanDispose))
    store.updateLastUsed('term-open')
    store.registerTerminal('term-new', make(() => {}))
    const state = useAppStore.getState()
    expect(state.terminalPool.has('term-orphan')).toBe(false)
    expect(orphanDispose).toHaveBeenCalledOnce()
    expect(openDispose).not.toHaveBeenCalled()
    expect(state.terminalPool.has('term-open')).toBe(true)
    expect(state.tabs.some((tab) => tab.id === 'tab-open')).toBe(true)
    expect(state.terminalPool.has('term-new')).toBe(true)
  })

  it('removes the owning tab when a protected terminal must be reclaimed', () => {
    __registerHandler('github.com/xuthus5/mssh/internal/service.TerminalService.Close', async () => {})
    const makeTerm = () => ({ dispose: () => {} }) as unknown as import('@xterm/xterm').Terminal
    useAppStore.setState({ maxPoolSize: 2, terminalPool: new Map(), tabs: [], activePaneId: null, activeSurface: null })
    const store = useAppStore.getState()
    store.openTab({ id: 'tab-old', title: 'Old', type: 'terminal', terminalId: 'term-old', sessionId: 1 })
    store.openTab({ id: 'tab-active', title: 'Active', type: 'terminal', terminalId: 'term-active', sessionId: 2 })
    store.registerTerminal('term-old', makeTerm())
    store.registerTerminal('term-active', makeTerm())
    store.setActivePane('term-active')
    store.updateLastUsed('term-active')
    store.registerTerminal('term-new', makeTerm())
    const state = useAppStore.getState()
    expect(state.terminalPool.has('term-old')).toBe(false)
    expect(state.tabs.some((tab) => tab.id === 'tab-old')).toBe(false)
    expect(state.terminalPool.has('term-active')).toBe(true)
    expect(state.tabs.some((tab) => tab.id === 'tab-active')).toBe(true)
    expect(state.terminalPool.has('term-new')).toBe(true)
  })

  it('manages transfers', () => {
    const { addTransfer, updateTransfer, removeTransfer } = useAppStore.getState()
    addTransfer({
      id: 't1', fileName: 'test.txt', direction: 'upload',
      sessionId: 1, sessionName: '生产服务器', sourcePath: '/tmp/test.txt', targetPath: '/remote/test.txt',
      totalBytes: 100, transferredBytes: 0, speed: 0, eta: 0, status: 'queued', startedAt: Date.now(),
    })
    expect(useAppStore.getState().transfers).toHaveLength(1)
    expect(useAppStore.getState().transferCenterOpen).toBe(true)
    updateTransfer('t1', { transferredBytes: 50, speed: 1024 })
    expect(useAppStore.getState().transfers[0].transferredBytes).toBe(50)
    removeTransfer('t1')
    expect(useAppStore.getState().transfers).toHaveLength(0)
  })

  it('clears only finished transfer history', () => {
    const job = { sessionId: 1, sessionName: '生产服务器', sourcePath: '/a', targetPath: '/b', totalBytes: 10, transferredBytes: 0, speed: 0, eta: 0, startedAt: 1 } as const
    useAppStore.setState({ transfers: [
      { ...job, id: 'running', fileName: 'running.txt', direction: 'upload', status: 'running' },
      { ...job, id: 'failed', fileName: 'failed.txt', direction: 'download', status: 'failed', completedAt: 2 },
      { ...job, id: 'done', fileName: 'done.txt', direction: 'upload', status: 'completed', completedAt: 3 },
    ] })

    useAppStore.getState().clearFinishedTransfers()

    expect(useAppStore.getState().transfers.map((item) => item.id)).toEqual(['running'])
  })
  it('closes all split panes when closing a tab', async () => {
    const close = vi.fn(async () => {})
    __registerHandler('github.com/xuthus5/mssh/internal/service.TerminalService.Close', close)
    const primary = { dispose: vi.fn() } as unknown as import('@xterm/xterm').Terminal
    const split = { dispose: vi.fn() } as unknown as import('@xterm/xterm').Terminal
    const store = useAppStore.getState()
    store.openTab({
      id: 'tab-split',
      title: 'split',
      type: 'terminal',
      terminalId: 'primary-1',
      sessionId: 1,
      splitPaneIDs: ['primary-1', 'split-1'],
    } as never)
    store.registerTerminal('primary-1', primary)
    store.registerTerminal('split-1', split)
    store.setConnectionStatus('primary-1', 'connected')
    store.setConnectionStatus('split-1', 'connected')
    store.setActivePane('split-1')

    await store.closeTab('tab-split')

    expect(close).toHaveBeenCalledWith('primary-1')
    expect(close).toHaveBeenCalledWith('split-1')
    const state = useAppStore.getState()
    expect(state.tabs).toHaveLength(0)
    expect(state.terminalPool.has('primary-1')).toBe(false)
    expect(state.terminalPool.has('split-1')).toBe(false)
    expect(state.connectionStatus['split-1']).toBeUndefined()
    expect(state.activePaneId).toBeNull()
  })

  it('rewrites splitPaneIDs when replacing or promoting the primary terminal', () => {
    const store = useAppStore.getState()
    store.openTab({
      id: 'tab-1',
      title: 'A',
      type: 'terminal',
      terminalId: 'primary-1',
      sessionId: 1,
      splitPaneIDs: ['primary-1', 'split-1'],
    } as never)
    store.registerTerminal('primary-1', { dispose: vi.fn() } as never)
    store.registerTerminal('split-1', { dispose: vi.fn() } as never)

    expect(store.replaceTerminalConnection('tab-1', 'primary-1', 'primary-2')).toBe(true)
    expect(useAppStore.getState().tabs[0]).toMatchObject({
      terminalId: 'primary-2',
      splitPaneIDs: ['primary-2', 'split-1'],
    })

    useAppStore.setState({
      tabs: [{
        id: 'tab-1',
        title: 'A',
        type: 'terminal',
        terminalId: 'primary-2',
        sessionId: 1,
        splitPaneIDs: ['primary-2', 'split-1'],
      }],
    } as never)
    expect(store.promoteTerminalConnection('tab-1', 'primary-2', 'split-1')).toBe(true)
    expect(useAppStore.getState().tabs[0]).toMatchObject({
      terminalId: 'split-1',
      splitPaneIDs: ['split-1'],
    })
  })

})

describe('connection state machine', () => {
  it('accepts valid transitions and rejects stale connected events', () => {
    expect(canTransitionConnection('connected', 'reconnecting')).toBe(true)
    expect(canTransitionConnection('reconnecting', 'error')).toBe(true)
    expect(canTransitionConnection('closing', 'connected')).toBe(false)
  })
})
