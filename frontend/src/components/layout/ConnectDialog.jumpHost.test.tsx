import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectDialog } from '@/components/layout/ConnectDialog'
import { useConnectDialog } from '@/store/connectDialog'
import { useHostKeyPromptDialog } from '@/store/hostKeyPromptDialog'
import { useAppStore } from '@/store/appStore'
import { startEventBridge } from '@/store/eventBridge'
import { __clearHandlers, __emitEvent, __registerHandler } from '@/test/__mocks__/wails-runtime'

const sessionService = 'github.com/xuthus5/mssh/internal/service.SessionService.'
const jumpHost = { host: 'bastion.internal', port: 2222, username: 'deploy', authMethod: 'agent' as const }
let stopBridge: (() => void) | undefined
let decide = vi.fn(async () => undefined)

function openJumpConnection() {
  const dialogId = useConnectDialog.getState().openDialog('target.internal', 22, 'root', vi.fn(), '5')
  const requestId = useConnectDialog.getState().beginConnectionAttempt(dialogId, jumpHost)
  return { dialogId, requestId }
}

function progress(requestId: string, stage: 'jump' | 'target') {
  act(() => __emitEvent('session:progress', { data: { request_id: requestId, attempt_id: `${requestId}-${stage}`, stage } }))
}

function fingerprint(requestId: string, stage: 'jump' | 'target', options: { changed?: boolean; usesJumpHost?: boolean } = {}) {
  const { changed = false, usesJumpHost } = options
  act(() => __emitEvent('session:fingerprint', { data: {
    request_id: requestId, attempt_id: `${requestId}-${stage}`, is_jump_host: stage === 'jump',
    uses_jump_host: usesJumpHost,
    hostname: stage === 'jump' ? 'bastion.internal:2222' : 'target.internal:22',
    fingerprint: `SHA256:${stage}`, algorithm: 'ssh-ed25519', changed, expected: changed ? ['SHA256:old'] : [],
  } }))
}

function currentStep() {
  return within(screen.getByRole('list', { name: '连接进度' })).getAllByRole('listitem').find((item) => item.getAttribute('aria-current') === 'step')
}

beforeEach(() => {
  __clearHandlers()
  useConnectDialog.setState(useConnectDialog.getInitialState())
  useHostKeyPromptDialog.setState(useHostKeyPromptDialog.getInitialState())
  useAppStore.setState({ tabs: [], activeSurface: null, activePaneId: null, terminalPool: new Map() })
  decide = vi.fn(async () => undefined)
  __registerHandler(sessionService + 'DecideHostKey', decide)
  __registerHandler(sessionService + 'CancelConnect', vi.fn(async () => undefined))
  __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.ListTransfers', async () => [])
  stopBridge = startEventBridge()
})

afterEach(() => { act(() => stopBridge?.()); stopBridge = undefined; vi.useRealTimers(); vi.restoreAllMocks() })

describe('unified jump host connection progress', () => {
  it('keeps the original three steps for a direct connection', async () => {
    useConnectDialog.getState().openDialog('target.internal', 22, 'root', vi.fn(), '5')
    await act(async () => { render(<ConnectDialog />) })
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.queryByText('SSH 连接隧道')).not.toBeInTheDocument()
    expect(currentStep()).toHaveTextContent('建立连接')
  })

  it('keeps one modal across both host keys and all four jump connection steps', async () => {
    const { dialogId, requestId } = openJumpConnection()
    render(<ConnectDialog />)
    const modal = screen.getByRole('dialog')
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['SSH 连接隧道', '建立连接', '指纹确认', '连接成功'])
    expect(currentStep()).toHaveTextContent('SSH 连接隧道')
    expect(screen.getByText('正在连接 SSH 跳板机...')).toBeInTheDocument()
    progress(requestId, 'jump')
    fingerprint(requestId, 'jump')
    expect(screen.getByRole('heading', { name: '跳板机指纹确认' })).toBeInTheDocument()
    expect(currentStep()).toHaveTextContent('SSH 连接隧道')
    expect(screen.getByText('bastion.internal:2222')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '信任并连接' }))
    expect(decide).toHaveBeenCalledWith(`${requestId}-jump`, true)
    expect(currentStep()).toHaveTextContent('SSH 连接隧道')
    progress(requestId, 'target')
    expect(currentStep()).toHaveTextContent('建立连接')
    fingerprint(requestId, 'target')
    expect(screen.getByRole('heading', { name: '主机指纹确认' })).toBeInTheDocument()
    expect(currentStep()).toHaveTextContent('指纹确认')
    act(() => __emitEvent('session:attempt', { data: { attempt_id: `${requestId}-jump`, state: 'finished' } }))
    expect(screen.getByText('SHA256:target')).toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toEqual([modal])
    await userEvent.click(screen.getByRole('button', { name: '信任并连接' }))
    expect(decide).toHaveBeenCalledWith(`${requestId}-target`, true)
    act(() => useConnectDialog.getState().completeDialog(dialogId))
    expect(currentStep()).toHaveTextContent('连接成功')
    expect(screen.getAllByRole('dialog')).toEqual([modal])
    await userEvent.click(screen.getByRole('button', { name: '进入终端' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('uses jump-specific warning text for a changed bastion key', async () => {
    const { requestId } = openJumpConnection()
    render(<ConnectDialog />)
    fingerprint(requestId, 'jump', { changed: true })
    expect(screen.getByRole('heading', { name: '跳板机指纹已变化' })).toBeInTheDocument()
    expect(screen.getByText('SHA256:old')).toBeInTheDocument()
    expect(currentStep()).toHaveTextContent('SSH 连接隧道')
    await userEvent.click(screen.getByRole('button', { name: '拒绝' }))
    expect(decide).toHaveBeenCalledWith(`${requestId}-jump`, false)
  })

  it.each(['jump', 'target'] as const)('attributes a %s failure to its connection stage', async (stage) => {
    const { dialogId, requestId } = openJumpConnection()
    render(<ConnectDialog />)
    progress(requestId, stage)
    act(() => useConnectDialog.getState().failDialog(dialogId, 'authentication failed'))
    expect(screen.getByRole('heading', { name: stage === 'jump' ? 'SSH 连接隧道失败' : '目标 SSH 连接失败' })).toBeInTheDocument()
    expect(currentStep()).toHaveTextContent(stage === 'jump' ? 'SSH 连接隧道' : '建立连接')
    expect(screen.getByText('authentication failed')).toBeInTheDocument()
  })

  it('handles a background target fingerprint without borrowing foreground jump progress', async () => {
    const { requestId } = openJumpConnection()
    render(<ConnectDialog />)
    fingerprint('unknown-background-request', 'target', { usesJumpHost: false })
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(currentStep()).toHaveTextContent('指纹确认')
    await userEvent.click(screen.getByRole('button', { name: '拒绝' }))
    expect(decide).toHaveBeenCalledWith('unknown-background-request-target', false)
    expect(useConnectDialog.getState()).toMatchObject({ requestId, stage: 'jump', open: true })
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })

  it.each(['none', 'direct', 'jump'])('keeps both background fingerprints on four steps with %s foreground ownership', async (foreground) => {
    if (foreground === 'direct') useConnectDialog.getState().openDialog('target.internal', 22, 'root', vi.fn(), '5')
    if (foreground === 'jump') openJumpConnection()
    const previous = useConnectDialog.getState()
    render(<ConnectDialog />)
    fingerprint('background-jump-route', 'jump', { usesJumpHost: true })
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(currentStep()).toHaveTextContent('SSH 连接隧道')
    expect(useHostKeyPromptDialog.getState().active?.prompt).toMatchObject({ usesJumpHost: true })
    await userEvent.click(screen.getByRole('button', { name: '信任并连接' }))
    fingerprint('background-jump-route', 'target', { usesJumpHost: true })
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(currentStep()).toHaveTextContent('指纹确认')
    expect(screen.getByRole('heading', { name: '主机指纹确认' })).toBeInTheDocument()
    expect(useConnectDialog.getState()).toMatchObject({ dialogId: previous.dialogId, requestId: previous.requestId, stage: previous.stage })
    await userEvent.click(screen.getByRole('button', { name: '信任并连接' }))
    expect(decide).toHaveBeenCalledWith('background-jump-route-jump', true)
    expect(decide).toHaveBeenCalledWith('background-jump-route-target', true)
  })

  it('retires active and late prompts when a foreground attempt is replaced', async () => {
    const { dialogId, requestId: previous } = openJumpConnection()
    render(<ConnectDialog />)
    fingerprint(previous, 'jump')
    let requestId = ''
    act(() => { requestId = useConnectDialog.getState().beginConnectionAttempt(dialogId, jumpHost) })
    expect(screen.queryByText('SHA256:jump')).not.toBeInTheDocument()
    progress(previous, 'target')
    fingerprint(previous, 'target')
    expect(useHostKeyPromptDialog.getState().active).toBeNull()
    expect(currentStep()).toHaveTextContent('SSH 连接隧道')
    expect(useConnectDialog.getState().requestId).toBe(requestId)
    await waitFor(() => expect(decide).toHaveBeenCalledWith(`${previous}-jump`, false))
    expect(decide).toHaveBeenCalledWith(`${previous}-target`, false)
    fingerprint('live-background-request', 'target')
    expect(screen.getByText('SHA256:target')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '拒绝' }))
  })

  it('allows a standalone jump test fingerprint without opening a connection run', async () => {
    render(<ConnectDialog />)
    fingerprint('jump-test-request', 'jump')
    expect(screen.getByRole('heading', { name: '跳板机指纹确认' })).toBeInTheDocument()
    expect(currentStep()).toHaveTextContent('SSH 连接隧道')
    expect(useConnectDialog.getState().open).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: '信任并连接' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(useConnectDialog.getState().state).toBe('idle')
  })

  it('keeps the success delay unchanged for trusted jump and target keys', async () => {
    vi.useFakeTimers()
    const { dialogId, requestId } = openJumpConnection()
    render(<ConnectDialog />)
    progress(requestId, 'target')
    act(() => useConnectDialog.getState().completeDialog(dialogId))
    await act(async () => vi.advanceTimersByTimeAsync(799))
    expect(useConnectDialog.getState().open).toBe(true)
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(useConnectDialog.getState().open).toBe(false)
  })
})
