import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openLocalTerminal } from '@/lib/openLocalTerminal'
import { useAppStore } from '@/store/appStore'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'

describe('openLocalTerminal', () => {
  beforeEach(() => {
    __clearHandlers()
    useAppStore.setState({ tabs: [], activeSurface: null, terminalPool: new Map(), connectionStatus: {} })
    __registerHandler('github.com/xuthus5/mssh/internal/service.TerminalService.OpenLocal', async () => 'term-local-1')
  })

  it('opens a local terminal tab', async () => {
    const id = await openLocalTerminal('本地终端')
    expect(id).toBe('term-local-1')
    const tab = useAppStore.getState().tabs.find((item) => item.type === 'terminal' && item.terminalId === id)
    expect(tab).toMatchObject({ connectionKind: 'local', sessionId: 0, title: '本地终端' })
    expect(useAppStore.getState().connectionStatus[id]).toBe('connected')
  })
})
