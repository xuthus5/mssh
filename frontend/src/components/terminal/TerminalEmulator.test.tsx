import { createRef } from 'react'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'

const { useTerminal } = vi.hoisted(() => ({ useTerminal: vi.fn() }))
vi.mock('@/hooks/useTerminal', () => ({ useTerminal }))

import { TerminalEmulator } from '@/components/terminal/TerminalEmulator'

describe('TerminalEmulator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTerminalBehaviorStore.setState({ rightClickAction: 'menu', copyOnSelect: false, autoReconnect: false, restoreTabsOnStartup: true, scrollbackLines: 10000, renderer: 'dom' })
  })

  it('passes active state and the layer focus request to useTerminal', () => {
    const terminalRef = createRef<never>()
    terminalRef.current = {} as never
    useTerminal.mockReturnValue(terminalRef)
    const view = render(
      <TerminalEmulator terminalID="term-1" active focusRequest={{ sequence: 7 }} className="terminal-shell" />,
    )

    expect(useTerminal).toHaveBeenCalledWith('term-1', expect.objectContaining({ current: expect.any(HTMLDivElement) }), {
      active: true,
      focusRequest: { sequence: 7 },
    })
    expect(view.container.querySelector('.terminal-shell')).toHaveClass(
      '[&>.xterm]:h-full',
      '[&>.xterm]:w-full',
      '[&>.xterm]:pl-1',
    )
    expect(view.container.querySelector('[data-slot="context-menu-trigger"]')).toHaveClass('select-text')
  })
})
