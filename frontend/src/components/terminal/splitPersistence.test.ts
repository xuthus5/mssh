import { beforeEach, describe, expect, it, vi } from 'vitest'
import { insertSplit, splitLeaf, terminalIDs } from '@/components/terminal/splitTree'
import { serializeSplitLayout } from '@/components/terminal/splitLayout'
import {
  closeExtraSplitPanes,
  openExtraSplitPanes,
  openSplitTerminal,
  persistTabSplitLayout,
  restoreSplitTreeFromLayout,
} from '@/components/terminal/splitPersistence'
import { useAppStore } from '@/store/appStore'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'

const terminal = 'github.com/xuthus5/mssh/internal/service.TerminalService.'

describe('splitPersistence', () => {
  beforeEach(() => {
    __clearHandlers()
    useAppStore.setState({
      tabs: [{
        id: 'tab-1',
        title: 'prod',
        type: 'terminal',
        terminalId: 'primary',
        sessionId: 1,
      }],
      terminalPool: new Map(),
      connectionStatus: {},
      maxPoolSize: 16,
    } as never)
  })

  it('persists layout onto the tab and clears for serial', () => {
    const tree = insertSplit(splitLeaf('primary'), 'primary', 'second', 'horizontal', 'b1')
    persistTabSplitLayout('tab-1', tree, 'primary', 'ssh')
    expect(useAppStore.getState().tabs[0]).toMatchObject({
      splitLayout: { paneCount: 2 },
      splitPaneIDs: ['primary', 'second'],
    })
    persistTabSplitLayout('tab-1', tree, 'primary', 'serial')
    expect(useAppStore.getState().tabs[0]).toMatchObject({ splitLayout: null, splitPaneIDs: ['primary', 'second'] })
  })

  it('opens extra panes then materializes roles', async () => {
    let n = 0
    const openOne = vi.fn(async () => {
      n += 1
      return `extra-${n}`
    })
    const layout = serializeSplitLayout(
      insertSplit(splitLeaf('primary'), 'primary', 'second', 'vertical', 'b1'),
      'primary',
    )
    expect(layout).toBeTruthy()
    const restored = await restoreSplitTreeFromLayout(layout!, 'primary', openOne)
    expect(openOne).toHaveBeenCalledTimes(1)
    expect(restored && terminalIDs(restored.tree)).toEqual(['primary', 'extra-1'])
    expect(restored?.extraTerminalIDs).toEqual(['extra-1'])
  })

  it('cleans partial opens when a later open fails', async () => {
    __registerHandler(terminal + 'Close', async () => undefined)
    let calls = 0
    const openOne = vi.fn(async () => {
      calls += 1
      if (calls === 2) throw new Error('boom')
      return `extra-${calls}`
    })
    await expect(openExtraSplitPanes(2, openOne)).rejects.toThrow('boom')
  })

  it('closes provided extra panes for cancelled restores', async () => {
    const close = vi.fn(async () => undefined)
    __registerHandler(terminal + 'Close', close)
    closeExtraSplitPanes(['extra-a', 'extra-b'], 'test cleanup')
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(2))
  })

  it('inherits open size from preferred terminal', async () => {
    const open = vi.fn(async (_sessionId: number, cols: number, rows: number) => {
      expect(cols).toBe(132)
      expect(rows).toBe(43)
      return 'split-1'
    })
    __registerHandler(terminal + 'Open', open)
    useAppStore.setState({
      terminalPool: new Map([
        ['primary', { terminal: { cols: 132, rows: 43 }, lastUsed: 1 }],
      ]),
      activePaneId: 'primary',
    } as never)
    await openSplitTerminal(7, 'ssh', undefined, 'serial blocked', 'primary')
    expect(open).toHaveBeenCalled()
  })

  it('rewrites secondary splitPaneIDs when reconnecting a non-primary pane', async () => {
    const { replaceSecondaryTerminalRuntime } = await import('@/components/terminal/splitPersistence')
    useAppStore.setState({
      tabs: [{
        id: 'tab-1',
        title: 'prod',
        type: 'terminal',
        terminalId: 'primary',
        sessionId: 1,
        splitPaneIDs: ['primary', 'second'],
      }],
      terminalPool: new Map([
        ['primary', { terminal: { cols: 80, rows: 24 }, lastUsed: 1 }],
        ['second', { terminal: { cols: 80, rows: 24 }, lastUsed: 2 }],
      ]),
      connectionStatus: { primary: 'connected', second: 'connected' },
      activePaneId: 'second',
    } as never)
    replaceSecondaryTerminalRuntime('second', 'second-next', 'tab-1')
    const state = useAppStore.getState()
    expect(state.tabs[0]).toMatchObject({ splitPaneIDs: ['primary', 'second-next'] })
    expect(state.terminalPool.has('second')).toBe(false)
    expect(state.terminalPool.has('second-next')).toBe(true)
    expect(state.activePaneId).toBe('second-next')
  })
})

