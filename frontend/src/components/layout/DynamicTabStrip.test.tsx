import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

import { DynamicTabStrip } from '@/components/layout/DynamicTabStrip'
import { ToastContainer, useToastStore } from '@/components/ui/toast'
import { logger } from '@/lib/logger'
import { useAppStore } from '@/store/appStore'

const scrollIntoView = vi.fn()

function seedTabs() {
  useAppStore.setState({
    tabs: [
      { id: 'terminal-1', title: '生产服务器', type: 'terminal', terminalId: 'term-1' },
      { id: 'playback-1', title: '回放 #1', type: 'playback' },
    ],
    activeTabId: 'playback-1',
    activeSurface: { type: 'playback', id: 'playback-1' },
    connectionStatus: { 'term-1': 'connected' },
    recordingState: {},
  })
}

describe('DynamicTabStrip', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    scrollIntoView.mockClear()
    useToastStore.setState({ toasts: [] })
    useAppStore.setState({
      tabs: [],
      activeTabId: null,
      activeSurface: null,
      connectionStatus: {},
      recordingState: {},
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('activates a terminal without closing background tabs', async () => {
    seedTabs()
    render(<DynamicTabStrip />)

    await userEvent.click(screen.getByRole('tab', { name: /生产服务器/ }))

    expect(useAppStore.getState().activeSurface).toEqual({ type: 'terminal', id: 'terminal-1' })
    expect(useAppStore.getState().tabs).toHaveLength(2)
  })

  it('lists every dynamic tab in the overflow menu', async () => {
    seedTabs()
    render(<DynamicTabStrip />)

    await userEvent.click(screen.getByRole('button', { name: '打开标签列表' }))

    expect(screen.getByRole('menuitem', { name: /生产服务器/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /回放 #1/ })).toBeInTheDocument()
  })

  it('moves keyboard focus and activation between tabs', () => {
    seedTabs()
    render(<DynamicTabStrip />)
    const playbackTab = screen.getByRole('tab', { name: /回放 #1/ })

    playbackTab.focus()
    fireEvent.keyDown(playbackTab, { key: 'ArrowRight' })

    expect(useAppStore.getState().activeSurface).toEqual({ type: 'terminal', id: 'terminal-1' })
    expect(screen.getByRole('tab', { name: /生产服务器/ })).toHaveFocus()
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'nearest' })
  })

  it('activates a tab selected from the overflow menu', async () => {
    seedTabs()
    render(<DynamicTabStrip />)

    await userEvent.click(screen.getByRole('button', { name: '打开标签列表' }))
    await userEvent.click(screen.getByRole('menuitem', { name: '生产服务器' }))

    expect(useAppStore.getState().activeSurface).toEqual({ type: 'terminal', id: 'terminal-1' })
  })

  it('exposes terminal connection and playback state without relying on color', () => {
    seedTabs()
    render(<DynamicTabStrip />)

    expect(screen.getByLabelText('生产服务器：已连接')).toBeInTheDocument()
    expect(screen.getByLabelText('回放 #1：回放')).toBeInTheDocument()
  })

  it('requires confirmation before closing an active terminal connection', async () => {
    const closeTab = vi.fn(async () => {})
    seedTabs()
    useAppStore.setState({ closeTab })
    render(<DynamicTabStrip />)

    await userEvent.click(screen.getByRole('button', { name: '关闭 生产服务器' }))

    expect(screen.getByRole('dialog')).toHaveTextContent('关闭活动连接？')
    await userEvent.click(screen.getByRole('button', { name: '关闭连接' }))
    await waitFor(() => expect(closeTab).toHaveBeenCalledWith('terminal-1'))
  })

  it('shows an error toast when closing a playback tab fails', async () => {
    const closeTab = vi.fn(async () => { throw new Error('回放清理失败') })
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    seedTabs()
    useAppStore.setState({ closeTab })
    render(<><DynamicTabStrip /><ToastContainer /></>)

    await userEvent.click(screen.getByRole('button', { name: '关闭 回放 #1' }))

    await waitFor(() => expect(closeTab).toHaveBeenCalledWith('playback-1'))
    expect(await screen.findByRole('alert')).toHaveTextContent('关闭标签失败: 回放清理失败')
  })

  it('requests close from close-button Enter and Space without activating the tab', () => {
    const activateTab = vi.fn()
    seedTabs()
    useAppStore.setState({ activateTab })
    render(<DynamicTabStrip />)
    const tab = screen.getByRole('tab', { name: /生产服务器/ })
    const closeButton = screen.getByRole('button', { name: '关闭 生产服务器' })

    expect(tab).not.toContainElement(closeButton)
    closeButton.focus()
    fireEvent.keyDown(closeButton, { key: 'Enter' })
    fireEvent.keyDown(closeButton, { key: ' ' })

    expect(closeButton).toHaveFocus()
    expect(screen.getByRole('dialog')).toHaveTextContent('关闭活动连接？')
    expect(activateTab).not.toHaveBeenCalled()
  })

  it('activates a tab from its Enter key without requesting close', () => {
    const activateTab = vi.fn()
    seedTabs()
    useAppStore.setState({ activateTab })
    render(<DynamicTabStrip />)
    const tab = screen.getByRole('tab', { name: /生产服务器/ })

    fireEvent.keyDown(tab, { key: 'Enter' })

    expect(activateTab).toHaveBeenCalledWith('terminal-1', true)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
