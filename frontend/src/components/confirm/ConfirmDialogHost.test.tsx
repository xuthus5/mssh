import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ConfirmDialogHost } from '@/components/confirm/ConfirmDialogHost'
import { requestConfirm } from '@/lib/confirmDialog'

describe('ConfirmDialogHost', () => {
  it('confirms and cancels through AlertDialog actions', async () => {
    const user = userEvent.setup()
    render(<ConfirmDialogHost />)
    const pending = requestConfirm({
      title: '终端池已满',
      description: '将关闭标签',
      confirmLabel: '继续',
      destructive: true,
    })
    expect(await screen.findByText('终端池已满')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '继续' }))
    await expect(pending).resolves.toBe(true)

    const cancelled = requestConfirm({ title: '再次确认', description: 'desc' })
    expect(await screen.findByText('再次确认')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '取消' }))
    await expect(cancelled).resolves.toBe(false)
    await waitFor(() => expect(screen.queryByText('再次确认')).not.toBeInTheDocument())
  })
})
