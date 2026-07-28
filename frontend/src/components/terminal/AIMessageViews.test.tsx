import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ openURL: vi.fn() }))

vi.mock('@wailsio/runtime', () => ({ Browser: { OpenURL: runtime.openURL } }))
vi.mock('@/lib/wails', () => ({ AIService: { ExecuteCommand: vi.fn() } }))

import { AIMessageView, type AIPanelMessage } from '@/components/terminal/AIMessageViews'

describe('AIMessageView citations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runtime.openURL.mockResolvedValue(undefined)
  })

  it('opens validated citations in the system browser and shows the hostname', async () => {
    renderMessage({ title: 'Docs', url: 'https://Example.com/docs', snippet: '' })

    expect(screen.getByText('example.com')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Docs' }))

    expect(runtime.openURL).toHaveBeenCalledWith('https://example.com/docs')
  })

  it('blocks citations with unsafe URL schemes', () => {
    renderMessage({ title: 'Unsafe docs', url: 'javascript:alert(1)', snippet: '' })

    expect(screen.getByText('Unsafe docs')).toBeInTheDocument()
    expect(screen.getByTitle('引用链接已被安全策略阻止')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unsafe docs' })).not.toBeInTheDocument()
    expect(runtime.openURL).not.toHaveBeenCalled()
  })

  it('shows system-browser failures inline', async () => {
    runtime.openURL.mockRejectedValueOnce(new Error('open blocked'))
    renderMessage({ title: 'Docs', url: 'https://example.com/docs', snippet: '' })

    await userEvent.click(screen.getByRole('button', { name: 'Docs' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('打开引用链接失败: open blocked')
  })

  it('opens a pending citation only once', async () => {
    const pending = deferred<void>()
    runtime.openURL.mockReturnValueOnce(pending.promise)
    renderMessage({ title: 'Docs', url: 'https://example.com/docs', snippet: '' })
    const button = screen.getByRole('button', { name: 'Docs' })

    fireEvent.click(button)
    fireEvent.click(button)

    expect(runtime.openURL).toHaveBeenCalledOnce()
    await act(async () => { pending.resolve() })
  })

  it('ignores failures from a citation that changed while opening', async () => {
    const pending = deferred<void>()
    runtime.openURL.mockReturnValueOnce(pending.promise)
    const view = renderMessage({ title: 'Old docs', url: 'https://example.com/docs', snippet: '' })
    fireEvent.click(screen.getByRole('button', { name: 'Old docs' }))

    view.rerender(<AIMessageView message={messageWithCitation({ title: 'New docs', url: 'https://example.com/docs', snippet: '' })} sessionID={7} terminalID="term-1" conversationID={3} />)
    await act(async () => { pending.reject(new Error('stale failure')) })

    expect(screen.getByRole('button', { name: 'New docs' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

function renderMessage(citation: { title: string; url: string; snippet: string }) {
  return render(<AIMessageView message={messageWithCitation(citation)} sessionID={7} terminalID="term-1" conversationID={3} />)
}

function messageWithCitation(citation: { title: string; url: string; snippet: string }): AIPanelMessage {
  return { id: 'message-1', role: 'assistant', content: 'answer', citations: [citation] }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
