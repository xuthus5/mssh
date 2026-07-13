import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const { useTerminal } = vi.hoisted(() => ({ useTerminal: vi.fn() }))
vi.mock('@/hooks/useTerminal', () => ({ useTerminal }))

import { TerminalEmulator } from '@/components/terminal/TerminalEmulator'

describe('TerminalEmulator', () => {
  it('passes active state and the layer focus request to useTerminal', () => {
    const view = render(
      <TerminalEmulator terminalID="term-1" active focusRequest={{ sequence: 7 }} className="terminal-shell" />,
    )

    expect(useTerminal).toHaveBeenCalledWith('term-1', expect.objectContaining({ current: expect.any(HTMLDivElement) }), {
      active: true,
      focusRequest: { sequence: 7 },
    })
    expect(view.container.firstChild).toHaveClass('terminal-shell')
  })
})
