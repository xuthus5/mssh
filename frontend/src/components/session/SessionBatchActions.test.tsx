import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/wails', () => ({
  MacroService: { List: vi.fn(async () => [{ id: 3, name: '巡检', command: 'uptime\n' }]) },
  SessionService: {
    SessionsDeleteImpact: vi.fn(async () => ({ tunnels: 2, history: 4, recordings: 1 })),
  },
}))

import { SessionBatchActions } from '@/components/session/SessionBatchActions'
import { SessionService } from '@/lib/wails'

describe('SessionBatchActions', () => {
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
})
