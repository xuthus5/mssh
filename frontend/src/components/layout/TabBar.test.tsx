import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div role="dialog">{children}</div> : null,
  AlertDialogAction: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props} />,
  AlertDialogCancel: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

import TabBar from '@/components/layout/TabBar'
import { ToastContainer, useToastStore } from '@/components/ui/toast'
import { logger } from '@/lib/logger'
import { useAppStore } from '@/store/appStore'

describe('TabBar close integration', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    useAppStore.setState({
      tabs: [],
      activeTabId: null,
      connectionStatus: {},
      recordingState: {},
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('reports a rejected single-tab close', async () => {
    const closeTab = vi.fn(async () => { throw new Error('single close failed') })
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    useAppStore.setState({
      tabs: [{ id: 'one', title: 'One', type: 'playback' }],
      activeTabId: 'one',
      closeTab,
    })

    render(<><TabBar /><ToastContainer /></>)
    fireEvent.click(screen.getByRole('button', { name: '关闭 One' }))

    await waitFor(() => expect(closeTab).toHaveBeenCalledWith('one'))
    expect(await screen.findByRole('alert')).toHaveTextContent('关闭标签失败: single close failed')
  })

  it('reports a rejected close after confirming a batch', async () => {
    const closeTab = vi.fn(async (id: string) => {
      if (id === 'a') throw new Error('batch close failed')
    })
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    useAppStore.setState({
      tabs: [
        { id: 'keep', title: 'Keep', type: 'terminal', terminalId: 'term-keep' },
        { id: 'a', title: 'A', type: 'terminal', terminalId: 'term-a' },
        { id: 'b', title: 'B', type: 'terminal', terminalId: 'term-b' },
      ],
      activeTabId: 'keep',
      connectionStatus: { 'term-a': 'connected', 'term-b': 'connected' },
      closeTab,
    })

    render(<><TabBar /><ToastContainer /></>)
    const keepTab = screen.getByText('Keep').closest('[role="tab"]')
    expect(keepTab).not.toBeNull()
    fireEvent.contextMenu(keepTab!)
    fireEvent.click(screen.getByRole('button', { name: '关闭其他' }))
    fireEvent.click(screen.getByRole('button', { name: '关闭连接' }))

    await waitFor(() => expect(closeTab).toHaveBeenCalledTimes(2))
    expect(closeTab).toHaveBeenNthCalledWith(1, 'a')
    expect(closeTab).toHaveBeenNthCalledWith(2, 'b')
    expect(await screen.findByRole('alert')).toHaveTextContent('关闭标签失败: batch close failed')
  })
})
