import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recordCommand } from '@/lib/commandHistory'
import {
  installHistoryCommandPredict,
  updateLocalBuffer,
} from '@/components/terminal/terminalHistoryPredictRuntime'
import { DEFAULT_TERMINAL_BEHAVIOR, useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'

function createTermMock() {
  let keyHandler: ((event: KeyboardEvent) => boolean) | null = null
  return {
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
      keyHandler = handler
      return true
    },
    trigger(event: Partial<KeyboardEvent> & { key: string; type?: string }) {
      if (!keyHandler) throw new Error('missing handler')
      return keyHandler({
        type: 'keydown',
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        shiftKey: false,
        preventDefault: vi.fn(),
        ...event,
      } as KeyboardEvent)
    },
  }
}

describe('updateLocalBuffer', () => {
  it('tracks printable input and editing keys', () => {
    expect(updateLocalBuffer('', 'git st')).toBe('git st')
    expect(updateLocalBuffer('git st', '\u007f\u007f')).toBe('git ')
    expect(updateLocalBuffer('git status', '\r')).toBe('')
    expect(updateLocalBuffer('hello world', '\u0017')).toBe('hello ')
  })
})

describe('installHistoryCommandPredict', () => {
  beforeEach(() => {
    localStorage.clear()
    useTerminalBehaviorStore.setState({ ...DEFAULT_TERMINAL_BEHAVIOR, historyPredict: true })
  })

  it('completes history on Tab when enabled', () => {
    recordCommand(7, 'git commit -m "ship"')
    const term = createTermMock()
    let buffer = 'git co'
    const applyCompletion = vi.fn((suffix: string) => {
      buffer += suffix
    })
    installHistoryCommandPredict(term as never, {
      getSessionId: () => 7,
      getBuffer: () => buffer,
      applyCompletion,
    })
    const preventDefault = vi.fn()
    const handled = term.trigger({ key: 'Tab', preventDefault })
    expect(handled).toBe(false)
    expect(preventDefault).toHaveBeenCalled()
    expect(applyCompletion).toHaveBeenCalledWith('mmit -m "ship"')
    expect(buffer).toBe('git commit -m "ship"')
  })

  it('does not intercept Tab when disabled or no match', () => {
    recordCommand(7, 'ls -la')
    const term = createTermMock()
    const applyCompletion = vi.fn()
    installHistoryCommandPredict(term as never, {
      getSessionId: () => 7,
      getBuffer: () => 'ls',
      applyCompletion,
      isEnabled: () => false,
    })
    expect(term.trigger({ key: 'Tab' })).toBe(true)
    expect(applyCompletion).not.toHaveBeenCalled()

    installHistoryCommandPredict(term as never, {
      getSessionId: () => 7,
      getBuffer: () => 'zzz',
      applyCompletion,
    })
    expect(term.trigger({ key: 'Tab' })).toBe(true)
  })
})
