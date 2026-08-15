import { act, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recordCommand } from '@/lib/commandHistory'
import {
  inlineSuggestionText,
  installCommandTokenPredict,
  tokenInsertion,
} from '@/components/terminal/terminalHistoryPredictRuntime'
import { DEFAULT_TERMINAL_BEHAVIOR, useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'

function createTermMock() {
  let keyHandler: ((event: KeyboardEvent) => boolean) | null = null
  const element = document.createElement('div')
  element.id = 'overlay-anchor'
  element.style.width = '8px'
  document.body.appendChild(element)
  const state = { baseY: 0, cursorY: 23, cursorX: 0, rows: 24 }
  const term = {
    rows: 24,
    buffer: {
      active: {
        get baseY() { return state.baseY },
        get cursorY() { return state.cursorY },
        get cursorX() { return state.cursorX },
      },
    },
    attachCustomKeyEventHandler(handler: ((event: KeyboardEvent) => boolean) | null) {
      keyHandler = handler
    },
    registerMarker: vi.fn(() => ({ line: state.baseY + state.cursorY, dispose: vi.fn() })),
    registerDecoration: vi.fn(() => ({
      element,
      onRender(callback: (rendered: HTMLElement) => void) { callback(element) },
      dispose: vi.fn(),
    })),
    trigger(event: Partial<KeyboardEvent> & { key: string }) {
      if (!keyHandler) throw new Error('missing key handler')
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
  return { term, state, element }
}

describe('tokenInsertion', () => {
  it('completes a partial token in place', () => {
    expect(tokenInsertion('ls -la', '-lahrt', 'prefix')).toBe('hrt ')
  })

  it('inserts a next token with a leading space', () => {
    expect(tokenInsertion('ls', '-lahrt', 'next')).toBe(' -lahrt ')
  })

  it('does not duplicate a trailing space', () => {
    expect(tokenInsertion('ls ', '-lahrt', 'next')).toBe('-lahrt ')
    expect(tokenInsertion('', 'ls', 'next')).toBe('ls ')
  })

  it('replaces a partial command with its full suffix', () => {
    expect(tokenInsertion('l', 's -lahrt', 'command')).toBe('s -lahrt ')
    expect(tokenInsertion('ls -', 'lahrt', 'command')).toBe('lahrt ')
  })
})

describe('inlineSuggestionText', () => {
  it('shows only the missing suffix for a partial token', () => {
    expect(inlineSuggestionText('ls -la', '-lahrt', 'prefix')).toBe('hrt')
  })

  it('prepends a space for the next token', () => {
    expect(inlineSuggestionText('ls', '-lahrt', 'next')).toBe(' -lahrt')
    expect(inlineSuggestionText('ls ', '-lahrt', 'next')).toBe('-lahrt')
    expect(inlineSuggestionText('', 'ls', 'next')).toBe('ls')
  })

  it('shows the full command suffix after the partial', () => {
    expect(inlineSuggestionText('l', 's -lahrt', 'command')).toBe('s -lahrt')
  })
})

describe('installCommandTokenPredict', () => {
  beforeEach(() => {
    localStorage.clear()
    useTerminalBehaviorStore.setState({ ...DEFAULT_TERMINAL_BEHAVIOR, historyPredict: true })
  })

  afterEach(() => {
    document.body.textContent = ''
  })

  it('renders the inline ghost from session history', async () => {
    recordCommand(7, 'ls -lahrt /usr/local/bin/claude')
    const { term } = createTermMock()
    const handlers = installCommandTokenPredict(term as never, {
      getSessionId: () => 7,
      getBuffer: () => 'ls',
      applyCompletion: vi.fn(),
    })
    await act(async () => { handlers.update() })
    expect(await screen.findByText((content) => content.includes('-lahrt'))).toBeInTheDocument()
    expect(term.registerDecoration).toHaveBeenCalled()
  })

  it('keeps the decoration anchored when only the cursor column moves', async () => {
    recordCommand(7, 'ls -lahrt /usr/local/bin/claude')
    const { term, state } = createTermMock()
    const handlers = installCommandTokenPredict(term as never, {
      getSessionId: () => 7,
      getBuffer: () => 'ls',
      applyCompletion: vi.fn(),
    })
    await act(async () => { handlers.update() })
    const decoratedOnce = term.registerDecoration.mock.calls.length
    state.cursorX = 5
    await act(async () => { handlers.update() })
    expect(term.registerDecoration.mock.calls.length).toBe(decoratedOnce)
    expect(await screen.findByText((content) => content.includes('-lahrt'))).toBeInTheDocument()
  })

  it('accepts the inline token on Tab and continues selecting', async () => {
    recordCommand(7, 'ls -lahrt /usr/local/bin/claude')
    const { term } = createTermMock()
    let buffer = 'ls'
    const applyCompletion = vi.fn((data: string) => { buffer += data })
    const handlers = installCommandTokenPredict(term as never, {
      getSessionId: () => 7,
      getBuffer: () => buffer,
      applyCompletion,
    })
    await act(async () => { handlers.update() })
    expect(term.trigger({ key: 'Tab' })).toBe(false)
    expect(applyCompletion).toHaveBeenCalledWith(' -lahrt ')
    expect(buffer).toBe('ls -lahrt ')

    await act(async () => { handlers.update() })
    expect(term.trigger({ key: 'Enter' })).toBe(false)
    expect(applyCompletion).toHaveBeenLastCalledWith('/usr/local/bin/claude ')
  })

  it('navigates the open list with arrows and accepts with Enter', async () => {
    recordCommand(7, 'git commit -m x')
    recordCommand(7, 'git checkout release')
    recordCommand(7, 'git checkout dev')
    recordCommand(7, 'git checkout main')
    const { term } = createTermMock()
    let buffer = 'git'
    const applyCompletion = vi.fn((data: string) => { buffer += data })
    const handlers = installCommandTokenPredict(term as never, {
      getSessionId: () => 7,
      getBuffer: () => buffer,
      applyCompletion,
    })
    await act(async () => { handlers.update() })
    expect(term.trigger({ key: 'Tab' })).toBe(false)
    await act(async () => { handlers.update() })
    expect(term.trigger({ key: 'Tab' })).toBe(false)
    expect(term.trigger({ key: 'Tab' })).toBe(false)
    expect(term.trigger({ key: 'Enter' })).toBe(false)
    expect(applyCompletion).toHaveBeenLastCalledWith('release ')
  })

  it('closes the list on Escape before accepting again', async () => {
    recordCommand(7, 'ls -lahrt /usr/local/bin/claude')
    const { term } = createTermMock()
    let buffer = 'ls'
    const applyCompletion = vi.fn((data: string) => { buffer += data })
    const handlers = installCommandTokenPredict(term as never, {
      getSessionId: () => 7,
      getBuffer: () => buffer,
      applyCompletion,
    })
    await act(async () => { handlers.update() })
    expect(term.trigger({ key: 'Tab' })).toBe(false)
    await act(async () => { handlers.update() })
    expect(term.trigger({ key: 'Escape' })).toBe(false)
    expect(term.trigger({ key: 'Tab' })).toBe(false)
    expect(applyCompletion).toHaveBeenLastCalledWith('/usr/local/bin/claude ')
  })

  it('passes Tab through when disabled or without candidates', async () => {
    recordCommand(7, 'ls -la')
    const { term } = createTermMock()
    const applyCompletion = vi.fn()
    installCommandTokenPredict(term as never, {
      getSessionId: () => 7,
      getBuffer: () => 'ls',
      applyCompletion,
      isEnabled: () => false,
    })
    expect(term.trigger({ key: 'Tab' })).toBe(true)
    expect(applyCompletion).not.toHaveBeenCalled()

    installCommandTokenPredict(term as never, {
      getSessionId: () => 7,
      getBuffer: () => 'zzz',
      applyCompletion,
    })
    expect(term.trigger({ key: 'Tab' })).toBe(true)
  })

  it('disposes the overlay and resets the key handler', async () => {
    recordCommand(7, 'ls -la')
    const { term } = createTermMock()
    const applyCompletion = vi.fn()
    const handlers = installCommandTokenPredict(term as never, {
      getSessionId: () => 7,
      getBuffer: () => 'ls',
      applyCompletion,
    })
    await act(async () => { handlers.update() })
    handlers.dispose()
    expect(term.trigger({ key: 'Tab' })).toBe(true)
    expect(applyCompletion).not.toHaveBeenCalled()
  })
})
