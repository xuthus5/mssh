import { describe, expect, it } from 'vitest'
import type { TerminalTab } from '@/store/appStore'
import { rewriteSplitPaneIDs, scrubTerminalRuntime, terminalTabPaneIDs } from '@/store/terminalTabPanes'

const tab = (overrides: Partial<TerminalTab> = {}): TerminalTab => ({
  id: 'tab-1',
  title: 'A',
  type: 'terminal',
  terminalId: 'primary',
  sessionId: 1,
  ...overrides,
})

describe('terminalTabPanes', () => {
  it('collects primary and split pane IDs without duplicates', () => {
    expect(terminalTabPaneIDs(tab({ splitPaneIDs: ['primary', 'split-a', 'split-b'] }))).toEqual([
      'primary',
      'split-a',
      'split-b',
    ])
    expect(terminalTabPaneIDs(tab())).toEqual(['primary'])
  })

  it('rewrites a pane id after reconnect or promote', () => {
    expect(rewriteSplitPaneIDs(['primary', 'split-a'], 'primary', 'primary-next')).toEqual([
      'primary-next',
      'split-a',
    ])
    expect(rewriteSplitPaneIDs(undefined, 'a', 'b')).toBeUndefined()
  })

  it('scrubs pool status and recording for closed panes', () => {
    const terminal = { dispose: () => {} } as never
    const result = scrubTerminalRuntime(
      {
        terminalPool: new Map([
          ['primary', { terminal, lastUsed: 1 }],
          ['split-a', { terminal, lastUsed: 2 }],
        ]),
        connectionStatus: { primary: 'connected', 'split-a': 'connected' },
        recordingState: { primary: 'recording' },
        activePaneId: 'split-a',
      },
      ['primary', 'split-a'],
    )
    expect(result.terminalPool.size).toBe(0)
    expect(result.connectionStatus).toEqual({})
    expect(result.recordingState).toEqual({})
    expect(result.activePaneId).toBeNull()
  })
})
