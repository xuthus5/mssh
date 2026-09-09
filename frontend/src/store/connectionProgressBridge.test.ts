import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConnectionProgressBridge } from '@/store/connectionProgressBridge'
import { createHostKeyPromptCoordinator } from '@/store/hostKeyPromptCoordinator'
import { useConnectDialog } from '@/store/connectDialog'
import { useHostKeyPromptDialog } from '@/store/hostKeyPromptDialog'
import { logger } from '@/lib/logger'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'

const service = 'github.com/xuthus5/mssh/internal/service.SessionService.'
const jumpHost = { host: 'jump.internal', port: 22, username: 'user', authMethod: 'agent' as const }
let coordinator: ReturnType<typeof createHostKeyPromptCoordinator>
let bridge: ReturnType<typeof createConnectionProgressBridge>
let decide = vi.fn(async () => undefined)
let cancel = vi.fn(async () => undefined)

function openJump() {
  const dialogId = useConnectDialog.getState().openDialog('target.internal', 22, 'user', vi.fn())
  return { dialogId, requestId: useConnectDialog.getState().beginConnectionAttempt(dialogId, jumpHost) }
}

function prompt(requestId: string, attemptId: string) {
  bridge.fingerprint({ request_id: requestId, attempt_id: attemptId, is_jump_host: true,
    hostname: 'jump.internal:22', fingerprint: 'SHA256:test', algorithm: 'ssh-ed25519' })
}

beforeEach(() => {
  __clearHandlers()
  useConnectDialog.setState(useConnectDialog.getInitialState())
  useHostKeyPromptDialog.setState(useHostKeyPromptDialog.getInitialState())
  decide = vi.fn(async () => undefined); cancel = vi.fn(async () => undefined)
  __registerHandler(service + 'DecideHostKey', decide)
  __registerHandler(service + 'CancelConnect', cancel)
  coordinator = createHostKeyPromptCoordinator()
  bridge = createConnectionProgressBridge(coordinator)
})

afterEach(() => { bridge.stop(); coordinator.stop(); vi.restoreAllMocks() })

describe('connection progress bridge', () => {
  it('ignores incomplete and unsupported progress payloads', () => {
    const { requestId } = openJump()
    bridge.progress(); bridge.progress({}); bridge.progress({ request_id: requestId })
    bridge.progress({ request_id: requestId, attempt_id: 'attempt', stage: 'unknown' })
    bridge.fingerprint(); bridge.fingerprint({})
    expect(useConnectDialog.getState()).toMatchObject({ requestId, stage: 'jump', attemptId: '' })
    expect(useHostKeyPromptDialog.getState().active).toBeNull()
  })

  it('clears retired queued prompts while preserving a live background prompt', async () => {
    const { dialogId, requestId } = openJump()
    prompt('background-request', 'background')
    prompt(requestId, 'queued-jump')
    prompt(requestId, 'queued-target')
    useConnectDialog.getState().beginConnectionAttempt(dialogId, jumpHost)
    expect(useHostKeyPromptDialog.getState().active?.prompt.attemptId).toBe('background')
    expect(decide).toHaveBeenCalledWith('queued-jump', false)
    expect(decide).toHaveBeenCalledWith('queued-target', false)
    await useHostKeyPromptDialog.getState().decide(true)
    await waitFor(() => expect(useHostKeyPromptDialog.getState().active).toBeNull())
  })

  it('falls back to attempt cancellation if rejecting a retired key fails', async () => {
    const { dialogId, requestId } = openJump()
    useConnectDialog.getState().closeDialog(dialogId)
    decide.mockRejectedValueOnce(new Error('decision unavailable'))
    prompt(requestId, 'retired')
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('retired'))
    expect(useHostKeyPromptDialog.getState().active).toBeNull()
  })

  it('handles failure of both retired-key rejection and cancellation', async () => {
    const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const { dialogId, requestId } = openJump()
    useConnectDialog.getState().closeDialog(dialogId)
    const decisionError = new Error('decision unavailable')
    const cancelError = new Error('cancellation unavailable')
    decide.mockRejectedValueOnce(decisionError); cancel.mockRejectedValueOnce(cancelError)
    prompt(requestId, 'retired')
    await waitFor(() => expect(log).toHaveBeenCalledWith('cancel retired host key attempt failed', { attemptId: 'retired', decisionError, cancelError }))
    expect(useHostKeyPromptDialog.getState().active).toBeNull()
  })

  it('does not reject a completed prompt again when its request is retired', async () => {
    const { dialogId, requestId } = openJump()
    prompt(requestId, 'finished')
    bridge.finish('finished')
    useConnectDialog.getState().closeDialog(dialogId)
    await Promise.resolve()
    expect(decide).not.toHaveBeenCalled()
  })
})
