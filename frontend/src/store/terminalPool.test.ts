import { describe, expect, it } from 'vitest'
import type { AppState, Tab } from '@/store/appStore'
import {
  clearTerminalRuntimeFields,
  findTabByTerminalID,
  protectedTerminalIDs,
  selectTerminalPoolEvictionID,
} from '@/store/terminalPool'

function terminalTab(id: string, terminalId: string): Tab {
  return { id, title: id, type: 'terminal', terminalId, sessionId: 1 }
}

function entry(lastUsed: number) {
  return {
    terminal: { dispose: () => {} } as never,
    lastUsed,
  }
}

function baseState(overrides: Partial<AppState> = {}): AppState {
  return {
    tabs: [],
    activeSurface: null,
    activePaneId: null,
    terminalPool: new Map(),
    connectionStatus: {},
    recordingState: {},
    ...overrides,
  } as AppState
}

describe('protectedTerminalIDs', () => {
  it('includes open terminal tabs and the active pane', () => {
    const state = baseState({
      tabs: [terminalTab('tab-a', 'term-a'), terminalTab('tab-b', 'term-b')],
      activePaneId: 'term-split',
      activeSurface: { type: 'terminal', id: 'tab-a' },
    })
    expect([...protectedTerminalIDs(state)].sort()).toEqual(['term-a', 'term-b', 'term-split'])
  })
})

describe('selectTerminalPoolEvictionID', () => {
  it('returns null for an empty pool', () => {
    expect(selectTerminalPoolEvictionID(baseState())).toBeNull()
  })

  it('prefers orphan pool entries over terminals bound to open tabs', () => {
    const pool = new Map([
      ['orphan-old', entry(1)],
      ['tab-term', entry(2)],
      ['orphan-new', entry(3)],
    ])
    const state = baseState({
      tabs: [terminalTab('tab-1', 'tab-term')],
      terminalPool: pool,
      activePaneId: 'tab-term',
    })
    expect(selectTerminalPoolEvictionID(state)).toBe('orphan-old')
  })

  it('falls back to LRU among protected terminals when only open tabs remain', () => {
    const pool = new Map([
      ['term-old', entry(1)],
      ['term-new', entry(5)],
      ['term-active', entry(2)],
    ])
    const state = baseState({
      tabs: [
        terminalTab('tab-old', 'term-old'),
        terminalTab('tab-new', 'term-new'),
        terminalTab('tab-active', 'term-active'),
      ],
      terminalPool: pool,
      activePaneId: 'term-active',
      activeSurface: { type: 'terminal', id: 'tab-active' },
    })
    expect(selectTerminalPoolEvictionID(state)).toBe('term-old')
  })

  it('never prefers the active pane while other victims exist', () => {
    const pool = new Map([
      ['term-active', entry(0)],
      ['term-other', entry(10)],
    ])
    const state = baseState({
      tabs: [terminalTab('tab-active', 'term-active'), terminalTab('tab-other', 'term-other')],
      terminalPool: pool,
      activePaneId: 'term-active',
    })
    expect(selectTerminalPoolEvictionID(state)).toBe('term-other')
  })
})

describe('clearTerminalRuntimeFields / findTabByTerminalID', () => {
  it('clears connection/recording and unsets active pane', () => {
    const state = baseState({
      activePaneId: 'term-1',
      connectionStatus: { 'term-1': 'connected', 'term-2': 'connecting' },
      recordingState: { 'term-1': 'recording' },
    })
    expect(clearTerminalRuntimeFields(state, 'term-1')).toEqual({
      connectionStatus: { 'term-2': 'connecting' },
      recordingState: {},
      activePaneId: null,
    })
  })

  it('finds the owning terminal tab', () => {
    const tabs: Tab[] = [
      terminalTab('tab-1', 'term-1'),
      { id: 'playback-1', title: 'Playback', type: 'playback', recordingPath: '/tmp/rec.cast' },
    ]
    expect(findTabByTerminalID(tabs, 'term-1')?.id).toBe('tab-1')
    expect(findTabByTerminalID(tabs, 'missing')).toBeUndefined()
  })
})
