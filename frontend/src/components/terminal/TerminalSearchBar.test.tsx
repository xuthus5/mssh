import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalSearchBar } from '@/components/terminal/TerminalSearchBar'
import { registerTerminalSearch, unregisterTerminalSearch } from '@/lib/terminalSearchRegistry'
import { useAppStore } from '@/store/appStore'

function searchAddon() {
  let resultListener: ((result: { resultIndex: number; resultCount: number }) => void) | null = null
  return {
    addon: {
      findNext: vi.fn(() => true),
      findPrevious: vi.fn(() => true),
      clearDecorations: vi.fn(),
      clearActiveDecoration: vi.fn(),
      onDidChangeResults: vi.fn((listener) => {
        resultListener = listener
        return { dispose: vi.fn() }
      }),
    },
    emit: (result: { resultIndex: number; resultCount: number }) => resultListener?.(result),
  }
}

describe('TerminalSearchBar', () => {
  beforeEach(() => {
    useAppStore.setState({ terminalPool: new Map([['term-1', { terminal: { focus: vi.fn() } as never, lastUsed: 0 }]]) })
  })
  afterEach(() => {
    unregisterTerminalSearch('term-1')
    unregisterTerminalSearch('term-2')
  })

  it('highlights incremental matches and navigates next and previous results', async () => {
    const search = searchAddon()
    registerTerminalSearch('term-1', search.addon as never)
    const onOpenChange = vi.fn()
    render(<TerminalSearchBar terminalID="term-1" open onOpenChange={onOpenChange} />)
    const input = screen.getByRole('textbox', { name: '搜索活跃终端' })

    await userEvent.type(input, 'root')
    expect(search.addon.findNext).toHaveBeenLastCalledWith('root', expect.objectContaining({ regex: false, caseSensitive: false, incremental: true, decorations: expect.any(Object) }))
    act(() => search.emit({ resultIndex: 0, resultCount: 3 }))
    expect(screen.getByLabelText('搜索结果位置')).toHaveTextContent('1 / 3')

    await userEvent.click(screen.getByRole('button', { name: '下一个搜索结果' }))
    expect(search.addon.findNext).toHaveBeenLastCalledWith('root', expect.objectContaining({ incremental: false }))
    await userEvent.click(screen.getByRole('button', { name: '上一个搜索结果' }))
    expect(search.addon.findPrevious).toHaveBeenCalledWith('root', expect.objectContaining({ regex: false }))
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
    expect(search.addon.findPrevious).toHaveBeenCalledTimes(2)
  })

  it('validates regex searches without crashing the terminal', async () => {
    const search = searchAddon()
    registerTerminalSearch('term-1', search.addon as never)
    render(<TerminalSearchBar terminalID="term-1" open onOpenChange={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '使用正则表达式' }))
    const input = screen.getByRole('textbox', { name: '搜索活跃终端' })

    fireEvent.change(input, { target: { value: '[' } })
    expect(screen.getByRole('alert')).toHaveTextContent('正则表达式无效')
    expect(screen.getByRole('button', { name: '下一个搜索结果' })).toBeDisabled()
    expect(search.addon.findNext).not.toHaveBeenCalled()

    await userEvent.clear(input)
    await userEvent.type(input, 'root.*#')
    expect(search.addon.findNext).toHaveBeenLastCalledWith('root.*#', expect.objectContaining({ regex: true }))
  })

  it('clears highlights, closes, and restores terminal focus', async () => {
    const search = searchAddon()
    const focus = vi.fn()
    useAppStore.setState({ terminalPool: new Map([['term-1', { terminal: { focus } as never, lastUsed: 0 }]]) })
    registerTerminalSearch('term-1', search.addon as never)
    const onOpenChange = vi.fn()
    render(<TerminalSearchBar terminalID="term-1" open onOpenChange={onOpenChange} />)

    await userEvent.keyboard('{Escape}')

    expect(search.addon.clearDecorations).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(focus).toHaveBeenCalledOnce()
  })

  it('moves an open search to the newly active split terminal', async () => {
    const first = searchAddon()
    const second = searchAddon()
    registerTerminalSearch('term-1', first.addon as never)
    registerTerminalSearch('term-2', second.addon as never)
    const view = render(<TerminalSearchBar terminalID="term-1" open onOpenChange={vi.fn()} />)
    await userEvent.type(screen.getByRole('textbox', { name: '搜索活跃终端' }), 'deploy')

    view.rerender(<TerminalSearchBar terminalID="term-2" open onOpenChange={vi.fn()} />)

    expect(first.addon.clearDecorations).toHaveBeenCalled()
    expect(second.addon.findNext).toHaveBeenCalledWith('deploy', expect.objectContaining({ incremental: true }))
  })
})
