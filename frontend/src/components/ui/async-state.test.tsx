import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AsyncState } from '@/components/ui/async-state'

describe('AsyncState', () => {
  it('renders loading, retryable error, empty, and success states', async () => {
    const retry = vi.fn()
    const view = render(<AsyncState pending error="" empty={false}><div>content</div></AsyncState>)
    expect(screen.getByLabelText('加载中')).toBeInTheDocument()
    view.rerender(<AsyncState pending={false} error="failed" onRetry={retry}><div>content</div></AsyncState>)
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(retry).toHaveBeenCalledOnce()
    view.rerender(<AsyncState pending={false} empty emptyText="没有记录"><div>content</div></AsyncState>)
    expect(screen.getByText('没有记录')).toBeInTheDocument()
    view.rerender(<AsyncState pending={false}><div>content</div></AsyncState>)
    expect(screen.getByText('content')).toBeInTheDocument()
  })
})
