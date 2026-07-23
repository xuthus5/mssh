import { describe, expect, it } from 'vitest'
import { createTerminalTab } from '@/lib/terminalTabs'
import type { Tab } from '@/store/appStore'

function terminalTab(sessionId: number, terminalInstance: number): Tab {
  return {
    id: `terminal-term-${sessionId}-${terminalInstance}`,
    title: terminalInstance === 1 ? 'Server' : `Server #${terminalInstance}`,
    type: 'terminal',
    terminalId: `term-${sessionId}-${terminalInstance}`,
    sessionId,
    terminalInstance,
  }
}

describe('createTerminalTab', () => {
  it('creates the first terminal from the backend terminal ID', () => {
    expect(createTerminalTab({ sessionID: 7, sessionName: '生产服务器', terminalID: 'term-abc', tabs: [] })).toEqual({
      id: 'terminal-term-abc',
      title: '生产服务器',
      type: 'terminal',
      terminalId: 'term-abc',
      sessionId: 7,
      terminalInstance: 1,
      toolPanel: null,
    })
  })

  it('uses the next available instance number for the same session', () => {
    const tabs = [terminalTab(7, 1), terminalTab(7, 2)]

    expect(createTerminalTab({ sessionID: 7, sessionName: '生产服务器', terminalID: 'term-new', tabs }).title).toBe('生产服务器 #3')
  })

  it('reuses the smallest available instance number without renaming open tabs', () => {
    const tabs = [terminalTab(7, 1), terminalTab(7, 3)]

    expect(createTerminalTab({ sessionID: 7, sessionName: '生产服务器', terminalID: 'term-new', tabs })).toMatchObject({
      title: '生产服务器 #2',
      terminalInstance: 2,
    })
  })

  it('ignores other sessions and playback tabs when numbering', () => {
    const tabs: Tab[] = [
      terminalTab(8, 1),
      { id: 'playback-1', title: '回放 #1', type: 'playback', recordingPath: '/tmp/recording-1.msshlog' },
    ]

    expect(createTerminalTab({ sessionID: 7, sessionName: '生产服务器', terminalID: 'term-new', tabs }).terminalInstance).toBe(1)
  })

  it('creates serial terminal tabs with independent instance counters', () => {
    const first = createTerminalTab({
      sessionID: 0,
      sessionName: 'ESP32',
      terminalID: 'term-s1',
      tabs: [],
      connectionKind: 'serial',
      serialPortId: 3,
    })
    expect(first).toMatchObject({ connectionKind: 'serial', serialPortId: 3, terminalInstance: 1, title: 'ESP32' })
    const second = createTerminalTab({
      sessionID: 0,
      sessionName: 'ESP32',
      terminalID: 'term-s2',
      tabs: [first],
      connectionKind: 'serial',
      serialPortId: 3,
    })
    expect(second.title).toBe('ESP32 #2')
  })

  it('creates local shell tabs without session assets', () => {
    expect(createTerminalTab({
      sessionID: 0,
      sessionName: '本地终端',
      terminalID: 'term-local',
      tabs: [],
      connectionKind: 'local',
    })).toMatchObject({
      sessionId: 0,
      connectionKind: 'local',
      title: '本地终端',
      terminalInstance: 1,
    })
  })
})
