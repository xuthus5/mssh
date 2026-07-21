import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState, Tab } from '@/store/appStore'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'
import {
  applyTerminalPoolEviction,
  ensureTerminalPoolCapacity,
  openTerminalWithPoolCapacity,
} from '@/store/terminalPoolReclaim'

const toast = vi.hoisted(() => vi.fn())
vi.mock('@/components/ui/toast', () => ({ toast }))

function terminalTab(id: string, terminalId: string, title = id): Tab {
  return { id, title, type: 'terminal', terminalId, sessionId: 1 }
}

function entry(lastUsed: number, dispose = vi.fn()) {
  return { terminal: { dispose } as never, lastUsed }
}

function createStore(initial: Partial<AppState>) {
  let state = {
    tabs: [],
    activeSurface: null,
    activePaneId: null,
    terminalPool: new Map(),
    connectionStatus: {},
    recordingState: {},
    maxPoolSize: 2,
    workspaceTab: 'sessions',
    overviewSection: 'sessions',
    overviewReturnSurface: null,
    navigationCollapsed: false,
    sidebarWidth: 280,
    focusRequest: { id: '', sequence: 0 },
    ...initial,
  } as AppState
  return {
    getState: () => state,
    setState: (partial: Partial<AppState>) => {
      state = { ...state, ...partial }
    },
  }
}

describe('applyTerminalPoolEviction', () => {
  beforeEach(() => {
    __clearHandlers()
    toast.mockReset()
    __registerHandler('github.com/xuthus5/mssh/internal/service.TerminalService.Close', async () => {})
  })

  it('disposes orphan xterm instances and clears runtime fields', () => {
    const dispose = vi.fn()
    const store = createStore({
      terminalPool: new Map([['orphan', entry(1, dispose)]]),
      connectionStatus: { orphan: 'connected' },
      activePaneId: 'orphan',
    })
    const partial = applyTerminalPoolEviction(store.getState(), 'orphan')
    expect(dispose).toHaveBeenCalledOnce()
    expect(partial.terminalPool?.has('orphan')).toBe(false)
    expect(partial.connectionStatus).toEqual({})
    expect(partial.activePaneId).toBeNull()
  })

  it('removes the owning tab without disposing the React-owned terminal instance', () => {
    const dispose = vi.fn()
    const store = createStore({
      tabs: [terminalTab('tab-1', 'term-1', 'old')],
      activeSurface: { type: 'terminal', id: 'tab-1' },
      terminalPool: new Map([['term-1', entry(1, dispose)]]),
      connectionStatus: { 'term-1': 'connected' },
    })
    const partial = applyTerminalPoolEviction(store.getState(), 'term-1')
    expect(dispose).not.toHaveBeenCalled()
    expect(partial.tabs).toEqual([])
    expect(partial.terminalPool?.has('term-1')).toBe(false)
    expect(partial.activeSurface).toEqual({ type: 'workspace', id: 'sessions' })
  })
})

describe('ensureTerminalPoolCapacity', () => {
  beforeEach(() => {
    __clearHandlers()
    toast.mockReset()
    __registerHandler('github.com/xuthus5/mssh/internal/service.TerminalService.Close', async () => {})
  })

  it('reclaims orphans without prompting', () => {
    const dispose = vi.fn()
    const store = createStore({
      maxPoolSize: 1,
      terminalPool: new Map([['orphan', entry(1, dispose)]]),
    })
    const ok = ensureTerminalPoolCapacity(store)
    expect(ok).toBe(true)
    expect(dispose).toHaveBeenCalledOnce()
    expect(store.getState().terminalPool.size).toBe(0)
    expect(toast).toHaveBeenCalledWith('已释放空闲终端实例以腾出连接池', 'info')
  })

  it('prompts before reclaiming an open tab and announces recovery path', () => {
    const store = createStore({
      maxPoolSize: 1,
      tabs: [terminalTab('tab-old', 'term-old', '生产')],
      terminalPool: new Map([['term-old', entry(1)]]),
    })
    const confirmProtected = vi.fn(() => true)
    const ok = ensureTerminalPoolCapacity({ ...store, confirmProtected })
    expect(ok).toBe(true)
    expect(confirmProtected).toHaveBeenCalledOnce()
    expect(store.getState().tabs).toEqual([])
    expect(toast).toHaveBeenCalledWith(
      '已关闭标签「生产」以腾出终端池。可从会话列表重新连接该会话。',
      'warning',
    )
  })

  it('aborts when the user declines reclaiming a protected terminal', () => {
    const store = createStore({
      maxPoolSize: 1,
      tabs: [terminalTab('tab-old', 'term-old', '生产')],
      terminalPool: new Map([['term-old', entry(1)]]),
    })
    const ok = ensureTerminalPoolCapacity({ ...store, confirmProtected: () => false })
    expect(ok).toBe(false)
    expect(store.getState().tabs).toHaveLength(1)
    expect(store.getState().terminalPool.has('term-old')).toBe(true)
    expect(toast).toHaveBeenCalledWith('已取消打开新终端：终端池已满且未释放现有标签', 'info')
  })
})

describe('openTerminalWithPoolCapacity', () => {
  beforeEach(() => {
    __clearHandlers()
    toast.mockReset()
    __registerHandler('github.com/xuthus5/mssh/internal/service.TerminalService.Close', async () => {})
  })

  it('opens only after capacity is available', async () => {
    const store = createStore({ maxPoolSize: 1, terminalPool: new Map() })
    const open = vi.fn(async () => 'term-new')
    await expect(openTerminalWithPoolCapacity(open, store)).resolves.toBe('term-new')
    expect(open).toHaveBeenCalledOnce()
  })

  it('does not open when protected reclaim is cancelled', async () => {
    const store = createStore({
      maxPoolSize: 1,
      tabs: [terminalTab('tab-old', 'term-old')],
      terminalPool: new Map([['term-old', entry(1)]]),
    })
    const open = vi.fn(async () => 'term-new')
    await expect(openTerminalWithPoolCapacity(open, store, { confirmProtected: () => false }))
      .rejects.toThrow('终端池已满')
    expect(open).not.toHaveBeenCalled()
  })
})
