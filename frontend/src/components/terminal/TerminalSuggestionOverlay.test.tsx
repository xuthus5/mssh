import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TerminalSuggestionOverlay } from '@/components/terminal/TerminalSuggestionOverlay'

function renderOverlay(props: Partial<Parameters<typeof TerminalSuggestionOverlay>[0]> = {}) {
  const defaults = {
    inline: '',
    candidates: [] as string[],
    selectedIndex: 0,
    leftOffset: 0,
    showAbove: false,
    onSelect: vi.fn(),
  }
  return render(<TerminalSuggestionOverlay {...defaults} {...props} />)
}

describe('TerminalSuggestionOverlay', () => {
  it('renders ghost inline text', () => {
    renderOverlay({ inline: ' -lahrt' })
    expect(screen.getByText((content) => content.includes('-lahrt'))).toBeInTheDocument()
  })

  it('renders candidates and highlights the selected one', () => {
    renderOverlay({ candidates: ['-lahrt', '-l'], selectedIndex: 1 })
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual(['-lahrt', '-l'])
    expect(buttons[1].className).toContain('bg-accent')
  })

  it('selects a candidate on mouse down', () => {
    const onSelect = vi.fn()
    renderOverlay({ candidates: ['-lahrt', '-l'], onSelect })
    fireEvent.mouseDown(screen.getByText('-l'))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('does not render the list when empty', () => {
    renderOverlay({ candidates: [] })
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
