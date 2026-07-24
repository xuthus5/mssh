import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const macroService = vi.hoisted(() => ({
  execute: vi.fn(async () => {}),
  list: vi.fn(async (): Promise<Array<{
    id: number; name: string; command: string; shortcut: string; delay_ms: number; sort_order: number; created_at: string
  }>> => []),
}))
const terminalWrite = vi.hoisted(() => vi.fn(async () => 0))
const recordCommand = vi.hoisted(() => vi.fn())
const notify = vi.hoisted(() => vi.fn())

vi.mock('@/lib/wails', () => ({
  MacroService: { Execute: macroService.execute, List: macroService.list },
  TerminalService: { Write: terminalWrite },
}))
vi.mock('@/lib/commandHistory', () => ({ recordCommand }))
vi.mock('@/components/ui/toast', () => ({ toast: notify }))

import { TerminalComposePanel } from '@/components/terminal/TerminalComposePanel'
import { useAppStore } from '@/store/appStore'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('TerminalComposePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    macroService.list.mockResolvedValue([])
    useAppStore.setState({ terminalPool: new Map() })
  })

  it('loads macros and executes multiline content in the active terminal', async () => {
    macroService.list.mockResolvedValue([{
      id: 1, name: '系统巡检', command: 'uptime', shortcut: 'Ctrl+U', delay_ms: 0, sort_order: 0, created_at: '',
    }])
    render(<TerminalComposePanel open terminalID="split-1" sessionID={7} onClose={vi.fn()} />)

    expect(await screen.findByRole('button', { name: '执行宏 系统巡检' })).toBeInTheDocument()
    const input = screen.getByRole('textbox', { name: '撰写终端内容' })
    await userEvent.type(input, 'echo first{shift>}{enter}{/shift}pwd')
    await userEvent.click(screen.getByRole('button', { name: '执行' }))

    expect(terminalWrite).toHaveBeenCalledWith('split-1', 'echo first\npwd\r')
    expect(recordCommand).toHaveBeenCalledWith(7, 'echo first\npwd')
    expect(input).toHaveValue('')
    await waitFor(() => expect(input).toHaveFocus())
  })

  it('pastes exact content through xterm without executing or recording it', async () => {
    const terminal = { paste: vi.fn(), focus: vi.fn() }
    useAppStore.setState({ terminalPool: new Map([['term-1', { terminal: terminal as never, lastUsed: 0 }]]) })
    render(<TerminalComposePanel open terminalID="term-1" sessionID={7} onClose={vi.fn()} />)

    const input = screen.getByRole('textbox', { name: '撰写终端内容' })
    await userEvent.type(input, 'printf hello')
    await userEvent.click(screen.getByRole('button', { name: '粘贴' }))

    expect(terminal.paste).toHaveBeenCalledWith('printf hello')
    expect(terminal.focus).toHaveBeenCalledOnce()
    expect(terminalWrite).not.toHaveBeenCalled()
    expect(recordCommand).not.toHaveBeenCalled()
    expect(input).toHaveValue('printf hello')
  })

  it('executes macros once and follows terminal changes', async () => {
    const execution = deferred<void>()
    macroService.list.mockResolvedValue([{
      id: 2, name: '查看目录', command: 'pwd\n', shortcut: '', delay_ms: 0, sort_order: 0, created_at: '',
    }])
    macroService.execute.mockReturnValueOnce(execution.promise)
    const view = render(<TerminalComposePanel open terminalID="term-1" sessionID={9} onClose={vi.fn()} />)
    const macro = await screen.findByRole('button', { name: '执行宏 查看目录' })

    await userEvent.click(macro)
    expect(macro).toBeDisabled()
    expect(macroService.execute).toHaveBeenCalledWith('term-1', 'pwd\n')
    await userEvent.click(macro)
    expect(macroService.execute).toHaveBeenCalledTimes(1)
    await act(async () => execution.resolve())
    await waitFor(() => expect(recordCommand).toHaveBeenCalledWith(9, 'pwd\n'))

    view.rerender(<TerminalComposePanel open terminalID="split-2" sessionID={9} onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '执行宏 查看目录' }))
    expect(macroService.execute).toHaveBeenLastCalledWith('split-2', 'pwd\n')
  })

  it('supports keyboard execution and preserves input when execution fails', async () => {
    terminalWrite.mockRejectedValueOnce(new Error('terminal unavailable'))
    render(<TerminalComposePanel open terminalID="term-1" sessionID={7} onClose={vi.fn()} />)

    const input = screen.getByRole('textbox', { name: '撰写终端内容' })
    await userEvent.type(input, 'whoami')
    await userEvent.keyboard('{Control>}{Enter}{/Control}')

    expect(await screen.findByText('执行失败: terminal unavailable')).toBeInTheDocument()
    expect(notify).not.toHaveBeenCalled()
    expect(input).toHaveValue('whoami')
    expect(recordCommand).not.toHaveBeenCalled()
  })

  it('reports macro execution failures without recording the command', async () => {
    macroService.list.mockResolvedValue([{
      id: 3, name: '失败宏', command: 'false', shortcut: '', delay_ms: 0, sort_order: 0, created_at: '',
    }])
    macroService.execute.mockRejectedValueOnce(new Error('remote rejected'))
    render(<TerminalComposePanel open terminalID="term-1" sessionID={7} onClose={vi.fn()} />)

    await userEvent.click(await screen.findByRole('button', { name: '执行宏 失败宏' }))

    expect(await screen.findByText('宏执行失败: remote rejected')).toBeInTheDocument()
    expect(notify).not.toHaveBeenCalled()
    expect(recordCommand).not.toHaveBeenCalled()
  })

  it('shows macro loading errors, retries, and handles unavailable paste targets', async () => {
    macroService.list.mockRejectedValueOnce(new Error('load failed'))
    const onClose = vi.fn()
    render(<TerminalComposePanel open terminalID="term-1" sessionID={7} onClose={onClose} />)

    expect(await screen.findByText('宏加载失败: load failed')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/宏加载失败/)).toBeInTheDocument())
    expect(notify).not.toHaveBeenCalledWith('加载宏失败: load failed', 'error')
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('暂无可用宏')).toBeInTheDocument()

    await userEvent.type(screen.getByRole('textbox', { name: '撰写终端内容' }), 'ls')
    await userEvent.click(screen.getByRole('button', { name: '粘贴' }))
    expect(await screen.findByText('当前终端不可用')).toBeInTheDocument()
    expect(notify).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: '关闭撰写面板' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('stays dormant while closed and disables blank submissions', async () => {
    const loading = deferred<Array<{
      id: number; name: string; command: string; shortcut: string; delay_ms: number; sort_order: number; created_at: string
    }>>()
    macroService.list.mockReturnValueOnce(loading.promise)
    const view = render(<TerminalComposePanel open={false} terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(macroService.list).not.toHaveBeenCalled()

    view.rerender(<TerminalComposePanel open terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: '执行' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '粘贴' })).toBeDisabled()
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    expect(terminalWrite).not.toHaveBeenCalled()
    expect(screen.getByLabelText('宏加载中')).toBeInTheDocument()
    await act(async () => loading.resolve([]))
    expect(await screen.findByText('暂无可用宏')).toBeInTheDocument()

    view.rerender(<TerminalComposePanel open={false} terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    view.rerender(<TerminalComposePanel open terminalID="term-1" sessionID={7} onClose={vi.fn()} />)
    await waitFor(() => expect(macroService.list).toHaveBeenCalledTimes(2))
  })
})
