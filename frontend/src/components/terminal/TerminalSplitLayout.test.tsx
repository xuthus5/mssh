import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SplitTreeView } from '@/components/terminal/TerminalSplitLayout'
import type { SplitNode } from '@/components/terminal/splitTree'

const splitTree: SplitNode = {
  kind: 'branch',
  id: 'branch-1',
  direction: 'horizontal',
  ratio: 50,
  first: { kind: 'leaf', id: 'leaf-1', terminalID: 'term-1' },
  second: { kind: 'leaf', id: 'leaf-2', terminalID: 'term-2' },
}

function renderSplit(onRatio: (branchID: string, ratio: number) => void) {
  const view = render(<SplitTreeView
    node={splitTree}
    primaryID="term-1"
    activePaneID="term-1"
    paneCount={2}
    closingID={null}
    onClose={vi.fn()}
    onReconnect={vi.fn()}
    onCloseTerminal={vi.fn()}
    onRatio={onRatio}
    registerHost={vi.fn()}
  />)
  const separator = view.getByRole('separator')
  Object.defineProperty(separator.parentElement, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500, x: 0, y: 0, toJSON: () => ({}) }),
  })
  return { ...view, separator }
}

describe('TerminalSplitLayout divider lifecycle', () => {
  it('keeps pane host refs attached across ordinary rerenders', () => {
    const registerHost = vi.fn()
    const view = render(<SplitTreeView
      node={splitTree}
      primaryID="term-1"
      activePaneID="term-1"
      paneCount={2}
      closingID={null}
      onClose={vi.fn()}
      onReconnect={vi.fn()}
      onCloseTerminal={vi.fn()}
      onRatio={vi.fn()}
      registerHost={registerHost}
    />)
    expect(registerHost).toHaveBeenCalledTimes(2)

    view.rerender(<SplitTreeView
      node={splitTree}
      primaryID="term-1"
      activePaneID="term-2"
      paneCount={2}
      closingID={null}
      onClose={vi.fn()}
      onReconnect={vi.fn()}
      onCloseTerminal={vi.fn()}
      onRatio={vi.fn()}
      registerHost={registerHost}
    />)

    expect(registerHost).toHaveBeenCalledTimes(2)
    expect(registerHost).not.toHaveBeenCalledWith(expect.any(String), expect.any(String), null)
  })

  it('stops resizing after pointer cancellation', () => {
    const onRatio = vi.fn()
    const view = renderSplit(onRatio)
    fireEvent.pointerDown(view.separator, { pointerId: 1, clientX: 500 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 600 })
    expect(onRatio).toHaveBeenLastCalledWith('branch-1', 60)

    fireEvent.pointerCancel(window, { pointerId: 1 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 700 })
    expect(onRatio).toHaveBeenCalledOnce()
  })

  it('removes drag listeners when the split tree unmounts', () => {
    const onRatio = vi.fn()
    const view = renderSplit(onRatio)
    fireEvent.pointerDown(view.separator, { pointerId: 2, clientX: 500 })
    view.unmount()

    fireEvent.pointerMove(window, { pointerId: 2, clientX: 700 })
    expect(onRatio).not.toHaveBeenCalled()
  })
})
