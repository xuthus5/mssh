import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { focusOpenedTerminal } from '@/hooks/sessionConnectionActionHooks'
import { useAppStore, type TerminalTab } from '@/store/appStore'
import { useConnectDialog } from '@/store/connectDialog'
import { useHostKeyPromptDialog } from '@/store/hostKeyPromptDialog'

const frames: Array<FrameRequestCallback> = []

async function flushFrames(count = 20) {
  for (let i = 0; i < count; i++) {
    if (frames.length === 0) break
    const callback = frames.shift()
    if (callback) callback(0)
    await Promise.resolve()
  }
}

beforeEach(() => {
  frames.length = 0
  useConnectDialog.setState(useConnectDialog.getInitialState())
  useHostKeyPromptDialog.setState(useHostKeyPromptDialog.getInitialState())
  useAppStore.setState({ activePaneId: null })
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
})

afterEach(() => {
  document.body.innerHTML = ''
  document.body.focus()
  useAppStore.setState({ tabs: [], terminalPool: new Map() })
  vi.restoreAllMocks()
})

function createTerm(stealOnce = false) {
  const textarea = document.createElement('textarea')
  const term = {
    textarea,
    focus: vi.fn(() => {
      if (stealOnce && term.focus.mock.calls.length === 1) {
        document.body.focus()
        return
      }
      document.body.appendChild(textarea)
      textarea.focus()
    }),
  }
  const tab: TerminalTab = { id: 'tab-1', title: 'srv', type: 'terminal', terminalId: 'term-1', sessionId: 1 }
  useAppStore.setState({
    tabs: [tab],
    activeSurface: { type: 'terminal', id: 'tab-1' },
    terminalPool: new Map([['term-1', { terminal: term as never, lastUsed: Date.now() }]]),
  })
  return term
}

describe('focusOpenedTerminal', () => {
  it('waits for the terminal to mount and focuses it', async () => {
    const term = createTerm()
    const pool = useAppStore.getState().terminalPool
    useAppStore.setState({ terminalPool: new Map() })
    const promise = focusOpenedTerminal('term-1')
    await flushFrames(2)
    expect(term.focus).not.toHaveBeenCalled()
    useAppStore.setState({ terminalPool: pool })
    await flushFrames()
    await promise
    expect(term.focus).toHaveBeenCalled()
    expect(document.activeElement).toBe(term.textarea)
  })

  it('retries when the focus is stolen after the first attempt', async () => {
    const term = createTerm(true)
    const promise = focusOpenedTerminal('term-1')
    await flushFrames()
    await promise
    expect(term.focus.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(document.activeElement).toBe(term.textarea)
  })

  it('gives up without focusing when the terminal never mounts', async () => {
    const term = createTerm()
    useAppStore.setState({ terminalPool: new Map() })
    const promise = focusOpenedTerminal('term-1')
    await flushFrames(60)
    await promise
    expect(term.focus).not.toHaveBeenCalled()
  })

  it('stops a pending focus retry when another connection opens', async () => {
    const term = createTerm()
    term.focus.mockImplementation(() => {})
    const promise = focusOpenedTerminal('term-1')
    useConnectDialog.getState().openDialog('other.internal', 22, 'admin', vi.fn())
    await flushFrames(60)
    await promise
    expect(term.focus).toHaveBeenCalledOnce()
  })

  it('does not focus a terminal from an inactive surface or another selected split pane', async () => {
    const term = createTerm()
    useAppStore.setState({ activeSurface: null })
    await focusOpenedTerminal('term-1')
    expect(term.focus).not.toHaveBeenCalled()

    useAppStore.setState({
      activeSurface: { type: 'terminal', id: 'tab-1' },
      activePaneId: 'term-split',
      tabs: [{ id: 'tab-1', title: 'srv', type: 'terminal', terminalId: 'term-1', sessionId: 1, splitPaneIDs: ['term-1', 'term-split'] }],
    })
    await focusOpenedTerminal('term-1')
    expect(term.focus).not.toHaveBeenCalled()
  })
})
