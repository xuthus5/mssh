import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary } from '@/components/AppErrorBoundary'

function Boom({ fail }: { fail: boolean }) {
  if (fail) throw new Error('boom')
  return <div>app-ready</div>
}

describe('AppErrorBoundary', () => {
  it('recovers from a child render crash', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { rerender } = render(
      <AppErrorBoundary>
        <Boom fail />
      </AppErrorBoundary>,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('应用渲染失败')
    rerender(
      <AppErrorBoundary>
        <Boom fail={false} />
      </AppErrorBoundary>,
    )
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('app-ready')).toBeInTheDocument()
    spy.mockRestore()
  })
})
