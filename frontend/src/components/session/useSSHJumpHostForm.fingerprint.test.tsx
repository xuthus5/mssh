import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSSHJumpHostForm } from '@/components/session/useSSHJumpHostForm'
import { useHostKeyPromptDialog } from '@/store/hostKeyPromptDialog'
import { useConnectDialog } from '@/store/connectDialog'
import { startEventBridge } from '@/store/eventBridge'
import { __clearHandlers, __emitEvent, __registerHandler } from '@/test/__mocks__/wails-runtime'
import type { Session } from '@/lib/sessionModels'

const service = 'github.com/xuthus5/mssh/internal/service.SessionService.'
const session: Session = {
  id: '5', name: 'Internal', host: 'target.internal', port: 22, username: 'root', authMethod: 'agent',
  keepAlive: 0, termType: 'xterm', folderId: null,
  jumpHost: { host: 'jump.internal', port: 22, username: 'deploy', authMethod: 'agent' },
}
let stopBridge: (() => void) | undefined
let decide = vi.fn(async () => undefined)

function deferredTest() {
  let resolve!: () => void
  const promise = new Promise<void>((accept) => { resolve = accept })
  return { promise, resolve }
}

function fingerprint(requestId: string, attemptId: string) {
  act(() => __emitEvent('session:fingerprint', { data: {
    request_id: requestId, attempt_id: attemptId, is_jump_host: true,
    hostname: 'jump.internal:22', fingerprint: 'SHA256:test', algorithm: 'ssh-ed25519',
  } }))
}

beforeEach(() => {
  __clearHandlers()
  useConnectDialog.setState(useConnectDialog.getInitialState())
  useHostKeyPromptDialog.setState(useHostKeyPromptDialog.getInitialState())
  decide = vi.fn(async () => undefined)
  __registerHandler(service + 'DecideHostKey', decide)
  __registerHandler(service + 'CancelConnect', vi.fn(async () => undefined))
  __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.ListTransfers', async () => [])
  stopBridge = startEventBridge()
})

afterEach(() => { act(() => stopBridge?.()); vi.restoreAllMocks() })

describe('jump test fingerprint cancellation', () => {
  it.each(['edit', 'close', 'unmount'])('retires pending test fingerprints on %s', async (action) => {
    const pending = deferredTest()
    let requestId = ''
    __registerHandler(service + 'TestSSHJumpHost', async (input: { request_id: string }) => { requestId = input.request_id; return pending.promise })
    const view = renderHook((props) => useSSHJumpHostForm(props), { initialProps: { open: true, session } })
    let operation!: Promise<void>
    act(() => { operation = view.result.current.testConnection() })
    await waitFor(() => expect(requestId).toBeTruthy())
    fingerprint(requestId, 'old-test')
    expect(useHostKeyPromptDialog.getState().active?.prompt.attemptId).toBe('old-test')
    if (action === 'edit') act(() => view.result.current.change({ host: 'new-jump.internal' }))
    else if (action === 'close') view.rerender({ open: false, session })
    else view.unmount()
    expect(useHostKeyPromptDialog.getState().active).toBeNull()
    expect(decide).toHaveBeenCalledWith('old-test', false)
    fingerprint(requestId, 'late-test')
    expect(useHostKeyPromptDialog.getState().active).toBeNull()
    expect(decide).toHaveBeenCalledWith('late-test', false)
    await act(async () => { pending.resolve(); await operation })
  })

  it('allows a new test fingerprint after cancelling the old test', async () => {
    const pending = deferredTest()
    const requests: string[] = []
    __registerHandler(service + 'TestSSHJumpHost', async (input: { request_id: string }) => { requests.push(input.request_id); return pending.promise })
    const { result } = renderHook(() => useSSHJumpHostForm({ open: true, session }))
    let first!: Promise<void>
    let second!: Promise<void>
    act(() => { first = result.current.testConnection() })
    await waitFor(() => expect(requests).toHaveLength(1))
    fingerprint(requests[0], 'old-test')
    act(() => result.current.change({ host: 'new-jump.internal' }))
    act(() => { second = result.current.testConnection() })
    await waitFor(() => expect(requests).toHaveLength(2))
    fingerprint(requests[1], 'new-test')
    act(() => __emitEvent('session:attempt', { data: { attempt_id: 'old-test', state: 'finished' } }))
    expect(useHostKeyPromptDialog.getState().active?.prompt).toMatchObject({ attemptId: 'new-test', requestId: requests[1] })
    await act(async () => useHostKeyPromptDialog.getState().decide(true))
    await act(async () => { pending.resolve(); await Promise.all([first, second]) })
    expect(result.current.testState.status).toBe('success')
  })
})
