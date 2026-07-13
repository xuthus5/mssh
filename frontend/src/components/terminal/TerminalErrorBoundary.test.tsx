import { useEffect } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  TerminalErrorBoundary,
  useTerminalRuntimeErrorReporter,
} from '@/components/terminal/TerminalErrorBoundary'
import { logger } from '@/lib/logger'

function ThrowingChild(): never {
  throw new Error('xterm render failed')
}

function RuntimeFailingLayer({ onMount, onUnmount }: { onMount: () => void; onUnmount: () => void }) {
  const reportRuntimeError = useTerminalRuntimeErrorReporter()
  useEffect(() => {
    onMount()
    return onUnmount
  }, [onMount, onUnmount])
  return <button type="button" onClick={() => reportRuntimeError(new Error('raf failed'), 'terminal activation')}>触发运行时错误</button>
}

function Sibling({ onMount, onUnmount }: { onMount: () => void; onUnmount: () => void }) {
  useEffect(() => {
    onMount()
    return onUnmount
  }, [onMount, onUnmount])
  return <div>相邻标签仍在运行</div>
}

function UnscopedRuntimeFailure() {
  const reportRuntimeError = useTerminalRuntimeErrorReporter()
  return <button type="button" onClick={() => reportRuntimeError(new Error('unscoped'), 'test')}>触发无边界错误</button>
}

describe('TerminalErrorBoundary', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

  afterEach(() => consoleError.mockClear())

  it('isolates render failures without unmounting a sibling', () => {
    const siblingUnmount = vi.fn()
    render(<>
      <TerminalErrorBoundary onClose={vi.fn()}><ThrowingChild /></TerminalErrorBoundary>
      <Sibling onMount={vi.fn()} onUnmount={siblingUnmount} />
    </>)

    expect(screen.getByText('终端渲染失败')).toBeInTheDocument()
    expect(screen.getByText('相邻标签仍在运行')).toBeInTheDocument()
    expect(siblingUnmount).not.toHaveBeenCalled()
  })

  it('remounts only the failed layer on retry and supports close', async () => {
    const layerMount = vi.fn()
    const layerUnmount = vi.fn()
    const siblingMount = vi.fn()
    const siblingUnmount = vi.fn()
    const onClose = vi.fn()
    render(<>
      <TerminalErrorBoundary onClose={onClose}>
        <RuntimeFailingLayer onMount={layerMount} onUnmount={layerUnmount} />
      </TerminalErrorBoundary>
      <Sibling onMount={siblingMount} onUnmount={siblingUnmount} />
    </>)

    await userEvent.click(screen.getByRole('button', { name: '触发运行时错误' }))
    expect(screen.getByText('终端渲染失败')).toBeInTheDocument()
    expect(layerUnmount).toHaveBeenCalledOnce()
    expect(siblingUnmount).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(screen.getByRole('button', { name: '触发运行时错误' })).toBeInTheDocument()
    expect(layerMount).toHaveBeenCalledTimes(2)
    expect(siblingMount).toHaveBeenCalledOnce()

    await userEvent.click(screen.getByRole('button', { name: '触发运行时错误' }))
    await userEvent.click(screen.getByRole('button', { name: '关闭标签' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(siblingUnmount).not.toHaveBeenCalled()
  })

  it('logs runtime failures rendered without a tab boundary', async () => {
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => {})
    render(<UnscopedRuntimeFailure />)

    await userEvent.click(screen.getByRole('button', { name: '触发无边界错误' }))

    expect(loggerError).toHaveBeenCalledWith('unscoped terminal runtime error', expect.objectContaining({ source: 'test' }))
  })
})
