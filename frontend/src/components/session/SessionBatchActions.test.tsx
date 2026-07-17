import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/wails', () => ({
  MacroService: { List: vi.fn(async () => [{ id: 3, name: '巡检', command: 'uptime\n' }]) },
}))

import { SessionBatchActions } from '@/components/session/SessionBatchActions'

describe('SessionBatchActions', () => {
  it('confirms macro execution and reports each node result', async () => {
    const executeMacro = vi.fn(async () => [
      { sessionId: '1', name: 'one', success: true },
      { sessionId: '2', name: 'two', success: false, error: 'permission denied' },
    ])
    render(<SessionBatchActions selectedIDs={['1', '2']} onBatchConnect={vi.fn(async () => [])} onBatchExecuteMacro={executeMacro} onComplete={vi.fn()} />)
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
})
