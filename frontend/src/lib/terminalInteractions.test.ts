import { describe, expect, it, vi } from 'vitest'
import {
  copyTerminalSelection,
  createCopyOnSelectController,
  pasteClipboardIntoTerminal,
  selectAllTerminal,
} from '@/lib/terminalInteractions'

function createTerminal(selection = 'selected') {
  let selectionChange = () => {}
  const disposeSelectionChange = vi.fn()
  const terminal = {
    getSelection: vi.fn(() => selection),
    paste: vi.fn(),
    selectAll: vi.fn(),
    focus: vi.fn(),
    onSelectionChange: vi.fn((callback: () => void) => {
      selectionChange = callback
      return { dispose: disposeSelectionChange }
    }),
  }
  return { terminal, emitSelectionChange: () => selectionChange(), setSelection: (value: string) => { selection = value }, disposeSelectionChange }
}

describe('terminal interactions', () => {
  it('copies, pastes, and selects all while focusing the terminal', async () => {
    const { terminal } = createTerminal()
    const clipboard = { writeText: vi.fn(async () => {}), readText: vi.fn(async () => 'payload') }

    expect(await copyTerminalSelection(terminal as never, clipboard)).toBe(true)
    await pasteClipboardIntoTerminal(terminal as never, clipboard)
    selectAllTerminal(terminal as never)

    expect(clipboard.writeText).toHaveBeenCalledWith('selected')
    expect(terminal.paste).toHaveBeenCalledWith('payload')
    expect(terminal.selectAll).toHaveBeenCalledOnce()
    expect(terminal.focus).toHaveBeenCalledTimes(3)
  })

  it('does not write an empty selection', async () => {
    const { terminal } = createTerminal('')
    const clipboard = { writeText: vi.fn(async () => {}) }

    expect(await copyTerminalSelection(terminal as never, clipboard)).toBe(false)
    expect(clipboard.writeText).not.toHaveBeenCalled()
  })

  it('propagates clipboard read and write failures', async () => {
    const { terminal } = createTerminal()
    const writeText = vi.fn(async () => { throw new Error('clipboard denied') })
    const readText = vi.fn(async () => { throw new Error('clipboard denied') })

    await expect(copyTerminalSelection(terminal as never, { writeText })).rejects.toThrow('clipboard denied')
    await expect(pasteClipboardIntoTerminal(terminal as never, { readText })).rejects.toThrow('clipboard denied')
  })

  it('debounces repeated selection changes to one final copy', async () => {
    vi.useFakeTimers()
    const { terminal, emitSelectionChange, setSelection } = createTerminal('first')
    const clipboard = { writeText: vi.fn(async () => {}) }
    const controller = createCopyOnSelectController(terminal as never, { clipboard, delay: 120 })

    controller.setEnabled(true)
    emitSelectionChange()
    setSelection('final')
    emitSelectionChange()
    await vi.advanceTimersByTimeAsync(120)

    expect(clipboard.writeText).toHaveBeenCalledOnce()
    expect(clipboard.writeText).toHaveBeenCalledWith('final')
    expect(terminal.focus).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('cancels pending copies when disabled and skips empty selections', async () => {
    vi.useFakeTimers()
    const { terminal, emitSelectionChange } = createTerminal('selected')
    const clipboard = { writeText: vi.fn(async () => {}) }
    const controller = createCopyOnSelectController(terminal as never, { clipboard, delay: 120 })

    controller.setEnabled(true)
    emitSelectionChange()
    controller.setEnabled(false)
    await vi.advanceTimersByTimeAsync(120)
    controller.setEnabled(true)
    terminal.getSelection.mockReturnValue('')
    emitSelectionChange()
    await vi.advanceTimersByTimeAsync(120)

    expect(clipboard.writeText).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('reports copy failures and disposes its subscription only once', async () => {
    vi.useFakeTimers()
    const { terminal, emitSelectionChange, disposeSelectionChange } = createTerminal()
    const onError = vi.fn()
    const clipboard = { writeText: vi.fn(async () => { throw new Error('clipboard denied') }) }
    const controller = createCopyOnSelectController(terminal as never, { clipboard, onError, delay: 120 })

    controller.setEnabled(true)
    emitSelectionChange()
    await vi.advanceTimersByTimeAsync(120)
    controller.dispose()
    controller.dispose()

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'clipboard denied' }))
    expect(terminal.onSelectionChange).toHaveBeenCalledOnce()
    expect(disposeSelectionChange).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })
})
