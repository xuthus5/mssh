import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/wails', () => ({
  MacroService: { List: vi.fn(async () => [{ id: 3, name: '巡检', command: 'uptime\n' }]) },
  SessionService: {
    SessionsDeleteImpact: vi.fn(async () => ({ tunnels: 2, history: 4, recordings: 1, transfers: 0 })),
  },
}))

import { SessionBatchActions } from '@/components/session/SessionBatchActions'
import { useToastStore } from '@/components/ui/toast'
import { MacroService, SessionService } from '@/lib/wails'

describe('SessionBatchActions', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    vi.mocked(MacroService.List).mockResolvedValue([{ id: 3, name: '巡检', command: 'uptime\n' }] as never)
    vi.mocked(SessionService.SessionsDeleteImpact).mockResolvedValue({ tunnels: 2, history: 4, recordings: 1, transfers: 0 } as never)
  })

  it('confirms macro execution and reports each node result', async () => {
    const executeMacro = vi.fn(async () => [
      { sessionId: '1', name: 'one', success: true },
      { sessionId: '2', name: 'two', success: false, error: 'permission denied' },
    ])
    render(
      <SessionBatchActions
        selectedIDs={['1', '2']}
        onBatchConnect={vi.fn(async () => [])}
        onBatchExecuteMacro={executeMacro}
        onBatchDelete={vi.fn(async () => [])}
        onComplete={vi.fn()}
      />,
    )
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByRole('button', { name: /执行宏/ })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: /执行宏/ }))
    await user.click(await screen.findByRole('menuitem', { name: /巡检/ }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('执行宏“巡检”')
    await user.click(screen.getByRole('button', { name: '确认执行' }))

    expect(executeMacro).toHaveBeenCalledWith(['1', '2'], 'uptime\n')
    expect(await screen.findByText('成功 1 项，失败 1 项。')).toBeInTheDocument()
    expect(screen.getByText('permission denied')).toBeInTheDocument()
  })

  it('confirms batch delete with impact and reports results', async () => {
    const onBatchDelete = vi.fn(async () => [
      { sessionId: '1', name: 'one', success: true },
      { sessionId: '2', name: 'two', success: true },
    ])
    const onComplete = vi.fn()
    render(
      <SessionBatchActions
        selectedIDs={['1', '2']}
        onBatchConnect={vi.fn(async () => [])}
        onBatchExecuteMacro={vi.fn(async () => [])}
        onBatchDelete={onBatchDelete}
        onComplete={onComplete}
      />,
    )
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /批量删除/ }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('确认批量删除？')
    await waitFor(() => expect(dialog).toHaveTextContent('2 条隧道'))
    expect(SessionService.SessionsDeleteImpact).toHaveBeenCalledWith([1, 2])
    await user.click(screen.getByRole('button', { name: '确认删除' }))

    expect(onBatchDelete).toHaveBeenCalledWith(['1', '2'])
    expect(onComplete).toHaveBeenCalled()
    expect(await screen.findByText('成功 2 项，失败 0 项。')).toBeInTheDocument()
  })

  it('shows macro list failures inline without toast', async () => {
    useToastStore.setState({ toasts: [] })
    vi.mocked(MacroService.List).mockRejectedValueOnce(new Error('macro list failed'))
    render(
      <SessionBatchActions
        selectedIDs={['1']}
        onBatchConnect={vi.fn(async () => [])}
        onBatchExecuteMacro={vi.fn(async () => [])}
        onBatchDelete={vi.fn(async () => [])}
        onComplete={vi.fn()}
      />,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('macro list failed')
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('shows delete impact failures in confirmation without faking zero impact', async () => {
    useToastStore.setState({ toasts: [] })
    vi.mocked(SessionService.SessionsDeleteImpact).mockRejectedValueOnce(new Error('impact failed'))
    const user = userEvent.setup()
    render(
      <SessionBatchActions
        selectedIDs={['1', '2']}
        onBatchConnect={vi.fn(async () => [])}
        onBatchExecuteMacro={vi.fn(async () => [])}
        onBatchDelete={vi.fn(async () => [])}
        onComplete={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /批量删除/ }))
    const dialog = await screen.findByRole('alertdialog')
    await waitFor(() => expect(dialog).toHaveTextContent('impact failed'))
    expect(dialog).toHaveTextContent('影响范围未知')
    expect(dialog).not.toHaveTextContent('0 条隧道')
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})
