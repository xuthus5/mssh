import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalErrorBoundary } from '@/components/terminal/TerminalErrorBoundary'

function ThrowingChild({ broken }: { broken: boolean }) {
  if (broken) throw new Error('xterm render failed')
  return <div>终端已恢复</div>
}

function RecoveryHarness() {
  const [broken, setBroken] = useState(true)
  return (
    <TerminalErrorBoundary onClose={vi.fn()} onRetry={() => setBroken(false)}>
      <ThrowingChild broken={broken} />
    </TerminalErrorBoundary>
  )
}

describe('TerminalErrorBoundary', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

  afterEach(() => consoleError.mockClear())

  it('isolates a failed tab and retries only its child', async () => {
    render(<RecoveryHarness />)

    expect(screen.getByText('终端渲染失败')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '重试' }))

    expect(screen.getByText('终端已恢复')).toBeInTheDocument()
  })

  it('calls the supplied close callback', async () => {
    const onClose = vi.fn()
    render(
      <TerminalErrorBoundary onClose={onClose}>
        <ThrowingChild broken />
      </TerminalErrorBoundary>,
    )

    await userEvent.click(screen.getByRole('button', { name: '关闭标签' }))

    expect(onClose).toHaveBeenCalledOnce()
  })
})
