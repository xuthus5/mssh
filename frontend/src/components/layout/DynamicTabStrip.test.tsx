import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const connect = vi.hoisted(() => vi.fn(async () => {}))

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

vi.mock('@/hooks/SessionWorkspaceContext', () => ({
  useSessionWorkspace: () => ({ connect }),
}))

import { DynamicTabOverflowMenu, DynamicTabStrip } from '@/components/layout/DynamicTabStrip'
import { ToastContainer, useToastStore } from '@/components/ui/toast'
import { logger } from '@/lib/logger'
import { useAppStore } from '@/store/appStore'

const scrollIntoView = vi.fn()

function seedTabs() {
  useAppStore.setState({
    tabs: [
      { id: 'terminal-1', title: '生产服务器', type: 'terminal', terminalId: 'term-1', sessionId: 7, terminalInstance: 1 },
      { id: 'playback-1', title: '回放 #1', type: 'playback', recordingPath: '/tmp/recording-1.msshlog' },
    ],
    activeSurface: { type: 'playback', id: 'playback-1' },
    connectionStatus: { 'term-1': 'connected' },
    recordingState: {},
  })
}

describe('DynamicTabStrip', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    scrollIntoView.mockClear()
    connect.mockClear()
    useToastStore.setState({ toasts: [] })
    useAppStore.setState({
      tabs: [],
      activeSurface: null,
      connectionStatus: {},
      recordingState: {},
      focusRequest: { id: '', terminalId: null, sequence: 0 },
      activePaneId: null,
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
    expect(useAppStore.getState().focusRequest).toMatchObject({ id: 'terminal-1', sequence: 1 })
    expect(useAppStore.getState().tabs).toHaveLength(2)
  })

  it('duplicates a connected terminal from its context menu', async () => {
    seedTabs()
    render(<DynamicTabStrip />)

    fireEvent.contextMenu(screen.getByRole('tab', { name: /生产服务器/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: '复制终端' }))

    expect(connect).toHaveBeenCalledWith('7')
  })

  it('opens quick session search from the button after the last terminal tab', async () => {
    const openSearch = vi.fn()
    window.addEventListener('mssh:open-session-search', openSearch)
    useAppStore.setState({
      tabs: [
        { id: 'terminal-1', title: '生产服务器', type: 'terminal', terminalId: 'term-1', sessionId: 7, terminalInstance: 1 },
        { id: 'playback-1', title: '回放 #1', type: 'playback', recordingPath: '/tmp/recording-1.msshlog' },
        { id: 'terminal-2', title: '测试服务器', type: 'terminal', terminalId: 'term-2', sessionId: 8, terminalInstance: 1 },
        { id: 'playback-2', title: '回放 #2', type: 'playback', recordingPath: '/tmp/recording-2.msshlog' },
      ],
      activeSurface: { type: 'playback', id: 'playback-2' },
      connectionStatus: { 'term-1': 'connected', 'term-2': 'connecting' },
    })
    render(<DynamicTabStrip />)

    const terminalTab = screen.getByRole('tab', { name: /测试服务器/ })
    const playbackTab = screen.getByRole('tab', { name: /回放 #2/ })
    const quickConnect = screen.getByRole('button', { name: '快速连接会话' })
    expect(terminalTab.compareDocumentPosition(quickConnect) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(quickConnect.compareDocumentPosition(playbackTab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await userEvent.click(quickConnect)
    expect(openSearch).toHaveBeenCalledOnce()
    window.removeEventListener('mssh:open-session-search', openSearch)
  })

  it('hides quick connect when no SSH terminal tab exists', () => {
    useAppStore.setState({
      tabs: [{ id: 'playback-1', title: '回放 #1', type: 'playback', recordingPath: '/tmp/recording-1.msshlog' }],
      activeSurface: { type: 'playback', id: 'playback-1' },
    })

    render(<DynamicTabStrip />)

    expect(screen.queryByRole('button', { name: '快速连接会话' })).not.toBeInTheDocument()
  })

  it('does not offer terminal duplication for playback tabs', () => {
    seedTabs()
    render(<DynamicTabStrip />)

    fireEvent.contextMenu(screen.getByRole('tab', { name: /回放 #1/ }))

    expect(screen.queryByRole('menuitem', { name: '复制终端' })).not.toBeInTheDocument()
  })

  it('lists every dynamic tab in the overflow menu', async () => {
    seedTabs()
    render(<DynamicTabOverflowMenu />)

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
    expect(useAppStore.getState().focusRequest).toMatchObject({ id: 'terminal-1', sequence: 1 })
    expect(screen.getByRole('tab', { name: /生产服务器/ })).toHaveFocus()
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'nearest' })
  })

  it('activates a tab selected from the overflow menu', async () => {
    seedTabs()
    render(<DynamicTabOverflowMenu />)

    await userEvent.click(screen.getByRole('button', { name: '打开标签列表' }))
    await userEvent.click(screen.getByRole('menuitem', { name: '生产服务器' }))

    expect(useAppStore.getState().activeSurface).toEqual({ type: 'terminal', id: 'terminal-1' })
    expect(useAppStore.getState().focusRequest).toMatchObject({ id: 'terminal-1', sequence: 1 })
  })

  it('reports actual tab-list overflow without rendering the menu inline', () => {
    let triggerResize = () => {}
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        triggerResize = () => callback([], this as unknown as ResizeObserver)
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    })
    const onOverflowChange = vi.fn()
    seedTabs()
    const view = render(<DynamicTabStrip onOverflowChange={onOverflowChange} />)
    const tabList = screen.getByRole('tablist', { name: '动态标签' })
    let clientWidth = 300
    let scrollWidth = 300
    Object.defineProperty(tabList, 'clientWidth', { configurable: true, get: () => clientWidth })
    Object.defineProperty(tabList, 'scrollWidth', { configurable: true, get: () => scrollWidth })

    act(() => triggerResize())
    expect(onOverflowChange).toHaveBeenLastCalledWith(false)
    expect(screen.queryByRole('button', { name: '打开标签列表' })).not.toBeInTheDocument()

    clientWidth = 160
    scrollWidth = 320
    act(() => triggerResize())
    expect(onOverflowChange).toHaveBeenLastCalledWith(true)

    scrollWidth = 160
    act(() => triggerResize())
    expect(onOverflowChange).toHaveBeenLastCalledWith(false)
    expect(tabList.parentElement).not.toHaveClass('flex-1')

    scrollWidth = 320
    act(() => triggerResize())
    expect(onOverflowChange).toHaveBeenLastCalledWith(true)
    view.unmount()
    expect(onOverflowChange).toHaveBeenLastCalledWith(false)
  })

  it('includes terminal and playback status in each tab accessible name', () => {
    seedTabs()
    render(<DynamicTabStrip />)

    expect(screen.getByRole('tab', { name: '生产服务器，状态：已连接' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '回放 #1，状态：回放' })).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()

    act(() => useAppStore.setState({ connectionStatus: { 'term-1': 'disconnected' } }))

    expect(screen.getByRole('tab', { name: '生产服务器，状态：未连接' })).toBeInTheDocument()
  })

  it('links each dynamic tab to its persistent panel', () => {
    seedTabs()
    render(<DynamicTabStrip />)

    expect(screen.getByRole('tab', { name: /生产服务器/ })).toHaveAttribute('id', 'dynamic-tab-terminal-1')
    expect(screen.getByRole('tab', { name: /生产服务器/ })).toHaveAttribute('aria-controls', 'dynamic-panel-terminal-1')
    expect(screen.getByRole('tab', { name: /回放 #1/ })).toHaveAttribute('id', 'dynamic-tab-playback-1')
    expect(screen.getByRole('tab', { name: /回放 #1/ })).toHaveAttribute('aria-controls', 'dynamic-panel-playback-1')
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
